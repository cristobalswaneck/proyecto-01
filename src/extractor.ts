// Imagen -> ExtractedReceipt. La IA solo lee; no calcula ni valida.
import fs from "node:fs";
import type { Config } from "./config.js";
import { fileHash } from "./db.js";
import { ExtractedReceiptSchema, type ExtractedReceipt } from "./models.js";

export interface ExtractionResult {
  receipt: ExtractedReceipt;
  meta: Record<string, unknown>; // JSON crudo y uso de tokens, para auditar
}

export interface Extractor {
  extract(image: Buffer, mime: string): Promise<ExtractionResult>;
}

/** El modelo no devolvió un JSON válido: el ticket va a revisión. */
export class ExtractionError extends Error {}

/** El lector no está disponible (sin clave, sin implementar): no se guarda nada. */
export class ExtractorUnavailableError extends Error {}

const FIXTURES = new URL("../fixtures/tickets/", import.meta.url);

/** Datos de demostración (los tickets sintéticos de fixtures/). NO lee la imagen. */
export class StubExtractor implements Extractor {
  async extract(image: Buffer): Promise<ExtractionResult> {
    const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) throw new ExtractorUnavailableError("No hay datos de demostración.");
    const pick = files[parseInt(fileHash(image).slice(0, 8), 16) % files.length]!;
    const data = JSON.parse(fs.readFileSync(new URL(pick, FIXTURES), "utf-8"));
    const receipt = ExtractedReceiptSchema.parse(data);
    receipt.vendor = `${receipt.vendor ?? "Demo"} (demo)`;
    return { receipt, meta: { extractor: "stub", fixture: pick } };
  }
}

/** Lector con Claude. Pendiente (W1): hace falta la clave de la API. */
export class ClaudeExtractor implements Extractor {
  constructor(private readonly config: Pick<Config, "anthropicApiKey" | "anthropicModel">) {}
  async extract(): Promise<ExtractionResult> {
    throw new ExtractorUnavailableError(
      "El lector con IA todavía no está conectado. Usa EXTRACTOR=stub para la demostración.",
    );
  }
}

export function createExtractor(config: Config): Extractor {
  return config.extractor === "claude" ? new ClaudeExtractor(config) : new StubExtractor();
}
