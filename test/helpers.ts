import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type Config } from "../src/config.js";
import { openDb, type DB } from "../src/db.js";
import type { Extractor } from "../src/extractor.js";
import { ExtractedItemSchema, ExtractedReceiptSchema, type ExtractedItem, type ExtractedReceipt } from "../src/models.js";

export const item = (o: Partial<ExtractedItem> = {}): ExtractedItem =>
  ExtractedItemSchema.parse({ raw_description: "X", ...o });

export const receipt = (o: Partial<ExtractedReceipt> = {}): ExtractedReceipt =>
  ExtractedReceiptSchema.parse({
    vendor: "Mercadona", expense_date: "2026-10-01", total_amount: 10, currency: "EUR",
    category: "Alimentación", confidence: 0.95, ...o,
  });

export const goodReceipt = (o: Partial<ExtractedReceipt> = {}): ExtractedReceipt =>
  receipt({
    total_amount: 9,
    items: [item({ quantity: 1, unit_price: 4, line_total: 4 }), item({ quantity: 1, unit_price: 5, line_total: 5 })],
    ...o,
  });

export const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "gastos-test-"));
export const memDb = (): DB => openDb(":memory:");

export const testConfig = (o: Record<string, string> = {}): Config =>
  loadConfig({ DATA_DIR: tmpDir(), ...o } as NodeJS.ProcessEnv);

/** Extractor de pruebas: devuelve lo que se le indique, sin tocar la imagen. */
export const fakeExtractor = (r: ExtractedReceipt | Error): Extractor => ({
  async extract() {
    if (r instanceof Error) throw r;
    return { receipt: structuredClone(r), meta: { extractor: "fake" } };
  },
});

// PNG mínimo válido (cabecera) y distinto por semilla, para tener hashes distintos.
export const png = (seed = "a"): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(seed)]);

/** Cuerpo multipart/form-data con un único archivo. */
export function multipart(file: Buffer, filename = "t.png", contentType = "image/png") {
  const boundary = "----test" + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file, tail]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
