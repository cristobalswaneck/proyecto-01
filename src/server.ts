// Capa HTTP. La lógica de negocio vive en pipeline.ts / validators.ts / db.ts.
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TICKET_CATEGORIES, type Config } from "./config.js";
import { getReceipt, listReceipts, setCategory, setStatus, type DB, type ExpenseRow, type ItemRow } from "./db.js";
import { ExtractorUnavailableError, type Extractor } from "./extractor.js";
import * as insights from "./insights.js";
import { processImage } from "./pipeline.js";
import { ExtractedReceiptSchema } from "./models.js";
import { validateHeader, validateItems } from "./validators.js";

const COOKIE = "session";
const MONTH = 30 * 24 * 3600;

export interface Deps { config: Config; db: DB; extractor: Extractor; logger?: boolean }

/** Tipo de imagen por los primeros bytes (no nos fiamos del nombre ni del Content-Type). */
export function sniffImage(b: Buffer): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}

/** Los avisos no se guardan: se recalculan con las reglas actuales a partir de lo almacenado. */
function describe(r: { expense: ExpenseRow; items: ItemRow[] }) {
  const e = r.expense;
  const receipt = ExtractedReceiptSchema.parse({
    vendor: e.vendor, expense_date: e.expense_date, date_ambiguous: e.date_ambiguous === 1,
    purchase_time: e.purchase_time, base_amount: e.base_amount, vat_amount: e.vat_amount,
    total_amount: e.total_amount, currency: e.currency, category: e.category,
    payment_method: e.payment_method, confidence: e.confidence,
    items: r.items.map((i) => ({
      raw_description: i.raw_description ?? "", product_normalized: i.product_normalized,
      product_category: i.product_category, quantity: i.quantity, unit: i.unit,
      unit_price: i.unit_price, discount: i.discount, line_total: i.line_total,
    })),
  });
  const items = validateItems(receipt);
  return { ...r, issues: [...validateHeader(receipt), ...items.issues], itemsDiff: items.diff };
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function buildServer({ config, db, extractor, logger = true }: Deps): Promise<FastifyInstance> {
  // Detrás del proxy de Railway la IP real viene en X-Forwarded-For; sin esto, el límite de
  // intentos de acceso se compartiría entre todo el mundo y bastaría fallar 5 veces para bloquearte.
  const app = Fastify({ logger, bodyLimit: 1_000_000, trustProxy: config.production });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(multipart, { limits: { fileSize: config.maxImageBytes, files: 1, fields: 0 } });

  const authRequired = config.appPassword !== "";
  const isAuthed = (req: FastifyRequest): boolean => {
    if (!authRequired) return true;
    const raw = req.cookies[COOKIE];
    return raw !== undefined && req.unsignCookie(raw).value === "ok";
  };

  // Cabeceras de seguridad; sin scripts ni estilos en línea.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
  });

  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    const open = url === "/api/login" || url === "/api/session" || url === "/health";
    if (url.startsWith("/api/") && !open && !isAuthed(req)) {
      return reply.code(401).send({ error: "No autenticado" });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  // --- Acceso (contraseña única, con limitación de intentos fallidos) ---
  const attempts = new Map<string, { n: number; resetAt: number }>();
  app.post("/api/login", async (req: FastifyRequest<{ Body: { password?: string } }>, reply: FastifyReply) => {
    const now = Date.now();
    const a = attempts.get(req.ip);
    if (a && a.resetAt > now && a.n >= 5) return reply.code(429).send({ error: "Demasiados intentos. Espera unos minutos." });
    const given = typeof req.body?.password === "string" ? req.body.password : "";
    if (!authRequired || timingSafeEqual(digest(given), digest(config.appPassword))) {
      attempts.delete(req.ip);
      reply.setCookie(COOKIE, "ok", { signed: true, httpOnly: true, sameSite: "strict", secure: config.production, path: "/", maxAge: MONTH });
      return { ok: true };
    }
    attempts.set(req.ip, { n: a && a.resetAt > now ? a.n + 1 : 1, resetAt: a && a.resetAt > now ? a.resetAt : now + 10 * 60_000 });
    return reply.code(401).send({ error: "Contraseña incorrecta" });
  });
  app.post("/api/logout", async (_req, reply) => { reply.clearCookie(COOKIE, { path: "/" }); return { ok: true }; });
  app.get("/api/session", async (req) => ({ authenticated: isAuthed(req), authRequired, demo: config.extractor === "stub" }));

  // --- Tickets ---
  app.post("/api/receipts", async (req, reply) => {
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: "Falta el archivo." });
    const data = await part.toBuffer();
    if (part.file.truncated) return reply.code(413).send({ error: "La imagen es demasiado grande." });
    const mime = sniffImage(data);
    if (!mime) return reply.code(415).send({ error: "Formato no soportado. Usa JPG, PNG o WebP." });
    try {
      const result = await processImage(db, data, { extractor, imagesDir: config.imagesDir, mime, source: "web" });
      const found = result.expenseId === null ? null : getReceipt(db, result.expenseId);
      const receipt = found ? describe(found) : null;
      return reply.code(result.status === "rejected" ? 409 : 201).send({ result, receipt });
    } catch (e) {
      if (e instanceof ExtractorUnavailableError) return reply.code(503).send({ error: e.message });
      throw e;
    }
  });

  app.get("/api/receipts", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return listReceipts(db, { status: q.status, category: q.category, month: q.month, q: q.q });
  });

  const idOf = (req: FastifyRequest): number => Number((req.params as { id: string }).id);

  app.get("/api/receipts/:id", async (req, reply) => {
    const r = getReceipt(db, idOf(req));
    return r ? describe(r) : reply.code(404).send({ error: "No existe" });
  });

  app.post("/api/receipts/:id/confirm", async (req, reply) => {
    const r = getReceipt(db, idOf(req));
    if (!r) return reply.code(404).send({ error: "No existe" });
    if (r.expense.status !== "pending" && r.expense.status !== "review") {
      return reply.code(409).send({ error: `No se puede confirmar un ticket en estado ${r.expense.status}.` });
    }
    setStatus(db, r.expense.id, "confirmed");
    return describe(getReceipt(db, r.expense.id)!);
  });

  app.post("/api/receipts/:id/discard", async (req, reply) => {
    const r = getReceipt(db, idOf(req));
    if (!r) return reply.code(404).send({ error: "No existe" });
    if (r.expense.status === "rejected") return reply.code(409).send({ error: "Ya estaba descartado." });
    setStatus(db, r.expense.id, "rejected");
    return describe(getReceipt(db, r.expense.id)!);
  });

  app.patch("/api/receipts/:id", async (req: FastifyRequest<{ Body: { category?: string } }>, reply) => {
    const r = getReceipt(db, idOf(req));
    if (!r) return reply.code(404).send({ error: "No existe" });
    const category = req.body?.category;
    if (typeof category !== "string" || !(TICKET_CATEGORIES as readonly string[]).includes(category)) {
      return reply.code(400).send({ error: "Categoría fuera de la lista." });
    }
    setCategory(db, r.expense.id, category);
    return describe(getReceipt(db, r.expense.id)!);
  });

  app.get("/api/receipts/:id/image", async (req, reply) => {
    const r = getReceipt(db, idOf(req));
    const file = r?.expense.image_path ? path.resolve(r.expense.image_path) : null;
    const root = path.resolve(config.imagesDir) + path.sep;
    if (!file || !file.startsWith(root) || !fs.existsSync(file)) return reply.code(404).send({ error: "Sin imagen" });
    const mime = sniffImage(fs.readFileSync(file)) ?? "application/octet-stream";
    return reply.header("Cache-Control", "private, max-age=3600").type(mime).send(fs.createReadStream(file));
  });

  // --- Análisis ---
  app.get("/api/insights/overview", async () => insights.overview(db));
  app.get("/api/insights/monthly-by-category", async () => insights.monthlyByCategory(db));
  app.get("/api/insights/top-vendors", async () => insights.topVendors(db));
  app.get("/api/insights/products", async () => insights.products(db));
  app.get("/api/insights/price-history", async (req, reply) => {
    const product = (req.query as { product?: string }).product;
    if (!product) return reply.code(400).send({ error: "Falta el producto." });
    return insights.priceHistory(db, product);
  });
  app.get("/api/categories", async () => TICKET_CATEGORIES);

  // --- Interfaz estática ---
  await app.register(fastifyStatic, { root: path.resolve("public"), prefix: "/" });
  await app.register(fastifyStatic, {
    root: path.resolve("node_modules/chart.js/dist"), prefix: "/vendor/chart/", decorateReply: false,
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error({ err: err.message }, "error interno");
    reply.code(status).send({ error: status === 500 ? "Error interno" : err.message });
  });

  return app;
}
