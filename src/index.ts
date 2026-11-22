import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createExtractor } from "./extractor.js";
import { buildServer } from "./server.js";

const config = loadConfig();
const db = openDb(config.dbPath);
const app = await buildServer({ config, db, extractor: createExtractor(config) });

if (!config.appPassword) app.log.warn("APP_PASSWORD vacía: acceso sin contraseña (solo desarrollo).");
if (config.extractor === "stub") app.log.warn("Lector de DEMOSTRACIÓN activo: no lee la imagen.");

const close = async () => { await app.close(); db.close(); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);

await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`Gastos escuchando en http://localhost:${config.port}`);
