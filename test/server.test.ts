import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ExtractorUnavailableError } from "../src/extractor.js";
import { buildServer } from "../src/server.js";
import { fakeExtractor, goodReceipt, memDb, multipart, png, testConfig } from "./helpers.js";

async function app(env: Record<string, string> = {}, ex = fakeExtractor(goodReceipt())) {
  const config = testConfig(env);
  const db = memDb();
  return { app: await buildServer({ config, db, extractor: ex, logger: false }), db, config };
}
const upload = (a: Awaited<ReturnType<typeof app>>["app"], file: Buffer, headers: Record<string, string> = {}, type = "image/png") => {
  const m = multipart(file, "t", type);
  return a.inject({ method: "POST", url: "/api/receipts", payload: m.payload, headers: { ...m.headers, ...headers } });
};

describe("subida y flujo (sin contraseña, desarrollo)", () => {
  let ctx: Awaited<ReturnType<typeof app>>;
  beforeEach(async () => { ctx = await app(); });

  it("sube una imagen, devuelve el ticket con avisos recalculados", async () => {
    const res = await upload(ctx.app, png("1"));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.result).toMatchObject({ status: "pending", itemsReconciled: true });
    expect(body.receipt.expense.vendor).toBe("Mercadona");
    expect(body.receipt.items).toHaveLength(2);
    expect(body.receipt.issues).toEqual([]);
  });
  it("rechaza lo que no es una imagen aunque diga serlo (415)", async () => {
    const res = await upload(ctx.app, Buffer.from("<html>no soy un png</html>"), {}, "image/png");
    expect(res.statusCode).toBe(415);
  });
  it("la misma imagen otra vez: 409 con referencia al original", async () => {
    await upload(ctx.app, png("1"));
    const res = await upload(ctx.app, png("1"));
    expect(res.statusCode).toBe(409);
    expect(res.json().result.duplicateOf).toBe(1);
  });
  it("imagen demasiado grande: 413", async () => {
    const small = await app({ MAX_IMAGE_BYTES: "100" });
    const res = await upload(small.app, Buffer.concat([png("x"), Buffer.alloc(500)]));
    expect(res.statusCode).toBe(413);
  });
  it("si el lector no está disponible: 503 y no se guarda nada", async () => {
    const c = await app({}, fakeExtractor(new ExtractorUnavailableError("sin clave")));
    const res = await upload(c.app, png("1"));
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("sin clave");
    expect((await c.app.inject("/api/receipts")).json()).toEqual([]);
  });
  it("confirmar, no poder confirmar dos veces, descartar", async () => {
    await upload(ctx.app, png("1"));
    const ok = await ctx.app.inject({ method: "POST", url: "/api/receipts/1/confirm" });
    expect(ok.json().expense).toMatchObject({ status: "confirmed" });
    expect(ok.json().expense.confirmed_at).toBeTruthy();
    expect((await ctx.app.inject({ method: "POST", url: "/api/receipts/1/confirm" })).statusCode).toBe(409);
    const d = await ctx.app.inject({ method: "POST", url: "/api/receipts/1/discard" });
    expect(d.json().expense.status).toBe("rejected");
    expect((await ctx.app.inject({ method: "POST", url: "/api/receipts/1/confirm" })).statusCode).toBe(409);
    expect((await ctx.app.inject({ method: "POST", url: "/api/receipts/99/confirm" })).statusCode).toBe(404);
  });
  it("cambiar categoría solo admite la lista cerrada", async () => {
    await upload(ctx.app, png("1"));
    const patch = (category: unknown) => ctx.app.inject({ method: "PATCH", url: "/api/receipts/1", payload: { category } });
    expect((await patch("Inventada")).statusCode).toBe(400);
    expect((await patch(7)).statusCode).toBe(400);
    expect((await patch("Ocio")).json().expense.category).toBe("Ocio");
  });
  it("sirve la imagen original, y nunca un archivo fuera de la carpeta de imágenes", async () => {
    await upload(ctx.app, png("1"));
    const img = await ctx.app.inject("/api/receipts/1/image");
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toContain("image/png");
    const outside = path.join(ctx.config.dataDir, "secreto.txt");
    fs.writeFileSync(outside, "secreto");
    ctx.db.prepare("UPDATE expenses SET image_path = ? WHERE id = 1").run(outside);
    expect((await ctx.app.inject("/api/receipts/1/image")).statusCode).toBe(404);
    ctx.db.prepare("UPDATE expenses SET image_path = ? WHERE id = 1").run(path.join(ctx.config.imagesDir, "..", "secreto.txt"));
    expect((await ctx.app.inject("/api/receipts/1/image")).statusCode).toBe(404);
  });
  it("lista y filtra", async () => {
    await upload(ctx.app, png("1"));
    expect((await ctx.app.inject("/api/receipts?status=pending")).json()).toHaveLength(1);
    expect((await ctx.app.inject("/api/receipts?status=confirmed")).json()).toHaveLength(0);
  });
  it("cabeceras de seguridad y páginas estáticas", async () => {
    const res = await ctx.app.inject("/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect((await ctx.app.inject("/vendor/chart/chart.umd.js")).statusCode).toBe(200);
  });
});

describe("acceso con contraseña", () => {
  const env = { APP_PASSWORD: "secreta-123", SESSION_SECRET: "x".repeat(32) };

  it("sin sesión la API devuelve 401, pero /health y /api/session no", async () => {
    const { app: a } = await app(env);
    expect((await a.inject("/api/receipts")).statusCode).toBe(401);
    expect((await a.inject("/api/insights/overview")).statusCode).toBe(401);
    expect((await upload(a, png("1"))).statusCode).toBe(401);
    expect((await a.inject("/health")).statusCode).toBe(200);
    expect((await a.inject("/api/session")).json()).toMatchObject({ authenticated: false, authRequired: true });
  });
  it("contraseña incorrecta: 401; correcta: cookie firmada que da acceso", async () => {
    const { app: a } = await app(env);
    const login = (password: string) => a.inject({ method: "POST", url: "/api/login", payload: { password } });
    expect((await login("mala")).statusCode).toBe(401);
    const ok = await login("secreta-123");
    expect(ok.statusCode).toBe(200);
    const set = String(ok.headers["set-cookie"]);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Strict");
    const cookie = set.split(";")[0]!;
    expect((await a.inject({ url: "/api/receipts", headers: { cookie } })).statusCode).toBe(200);
    expect((await upload(a, png("1"), { cookie })).statusCode).toBe(201);
  });
  it("una cookie falsificada no vale", async () => {
    const { app: a } = await app(env);
    expect((await a.inject({ url: "/api/receipts", headers: { cookie: "session=ok" } })).statusCode).toBe(401);
    expect((await a.inject({ url: "/api/receipts", headers: { cookie: "session=ok.firma-falsa" } })).statusCode).toBe(401);
  });
  it("tras 5 fallos seguidos bloquea los intentos (429), incluso con la contraseña buena", async () => {
    const { app: a } = await app(env);
    const login = (password: string) => a.inject({ method: "POST", url: "/api/login", payload: { password } });
    for (let i = 0; i < 5; i++) expect((await login("mala")).statusCode).toBe(401);
    expect((await login("secreta-123")).statusCode).toBe(429);
  });
});

describe("configuración", () => {
  it("en producción exige contraseña y secreto de sesión", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/APP_PASSWORD/);
    expect(() => loadConfig({ NODE_ENV: "production", APP_PASSWORD: "x" } as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
    expect(loadConfig({ NODE_ENV: "production", APP_PASSWORD: "x", SESSION_SECRET: "y".repeat(16) } as NodeJS.ProcessEnv).production).toBe(true);
  });
  it("por defecto usa el lector de demostración", () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).extractor).toBe("stub");
    expect(loadConfig({ EXTRACTOR: "claude" } as NodeJS.ProcessEnv).extractor).toBe("claude");
  });
});

describe("detrás de un proxy (producción)", () => {
  const env = { NODE_ENV: "production", APP_PASSWORD: "secreta-123", SESSION_SECRET: "x".repeat(32) };
  it("el límite de intentos es por IP real: quien falla no bloquea a los demás", async () => {
    const { app: a } = await app(env);
    const login = (ip: string, password: string) =>
      a.inject({ method: "POST", url: "/api/login", payload: { password }, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 5; i++) await login("203.0.113.9", "mala");
    expect((await login("203.0.113.9", "secreta-123")).statusCode).toBe(429);
    expect((await login("198.51.100.4", "secreta-123")).statusCode).toBe(200);
  });
});
