// Configuración (variables de entorno) y listas cerradas de categorías.
import path from "node:path";

export const TICKET_CATEGORIES = [
  "Alimentación", "Restauración", "Transporte", "Vivienda", "Suministros", "Salud", "Ocio",
  "Compras", "Tecnología", "Suscripciones", "Viajes", "Formación", "Otros",
] as const;

export const PRODUCT_CATEGORIES = [
  "Frutas y verduras", "Carne y pescado", "Lácteos y huevos", "Panadería", "Bebidas", "Despensa",
  "Congelados", "Snacks y dulces", "Limpieza", "Higiene", "Hogar", "Mascotas", "Otros",
] as const;

export const STATUSES = ["pending", "confirmed", "review", "rejected"] as const;
export const UNITS = ["ud", "kg", "l"] as const;
export const PAYMENT_METHODS = ["card", "cash", "other"] as const;

export type Status = (typeof STATUSES)[number];

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  imagesDir: string;
  /** Contraseña única de acceso. Vacía = sin login (solo permitido fuera de producción). */
  appPassword: string;
  sessionSecret: string;
  production: boolean;
  /** "stub" devuelve datos de demostración; "claude" usa la API (pendiente de implementar). */
  extractor: "stub" | "claude";
  anthropicApiKey: string;
  anthropicModel: string;
  maxImageBytes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? "data");
  const production = env.NODE_ENV === "production";
  const appPassword = env.APP_PASSWORD ?? "";
  const sessionSecret = env.SESSION_SECRET ?? "";
  if (production && !appPassword) {
    throw new Error("APP_PASSWORD es obligatoria en producción: la app contiene datos privados.");
  }
  if (production && sessionSecret.length < 16) {
    throw new Error("SESSION_SECRET (mínimo 16 caracteres) es obligatoria en producción.");
  }
  const extractor = env.EXTRACTOR === "claude" ? "claude" : "stub";
  return {
    port: Number(env.PORT ?? 3000),
    dataDir,
    dbPath: path.join(dataDir, "gastos.db"),
    imagesDir: path.join(dataDir, "images"),
    appPassword,
    sessionSecret: sessionSecret || "dev-secret-solo-para-desarrollo",
    production,
    extractor,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    anthropicModel: env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    maxImageBytes: Number(env.MAX_IMAGE_BYTES ?? 10_000_000),
  };
}
