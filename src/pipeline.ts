// bytes de imagen -> PipelineResult. No sabe nada de HTTP.
import fs from "node:fs";
import path from "node:path";
import { fileHash, findProbableDuplicates, getIdByHash, insertExpense, type DB } from "./db.js";
import { ExtractionError, type Extractor } from "./extractor.js";
import { ExtractedReceiptSchema, type PipelineResult, type ValidationIssue } from "./models.js";
import { decideStatus, validateHeader, validateItems } from "./validators.js";

export interface PipelineOptions {
  extractor: Extractor;
  imagesDir: string;
  mime: string;
  source?: string;
  today?: string;
}

/** Guarda el original en <imagesDir>/<año>/<mes>/<hash>.img con permisos 600. */
function saveImage(imagesDir: string, hash: string, data: Buffer, date: string | null): string {
  const d = date && /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const folder = path.join(imagesDir, d.slice(0, 4), d.slice(5, 7));
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${hash.slice(0, 16)}.img`);
  fs.writeFileSync(file, data, { mode: 0o600 });
  return file;
}

export async function processImage(db: DB, data: Buffer, o: PipelineOptions): Promise<PipelineResult> {
  const hash = fileHash(data);
  const existing = getIdByHash(db, hash);
  if (existing !== null) {
    return {
      status: "rejected", expenseId: null, itemsReconciled: false, itemsDiff: null,
      duplicateOf: existing, probableDuplicates: [],
      issues: [{ code: "duplicate_file", severity: "block", message: `Este ticket ya estaba registrado (id ${existing}).` }],
    };
  }

  let extraction;
  try {
    extraction = await o.extractor.extract(data, o.mime);
  } catch (e) {
    if (!(e instanceof ExtractionError)) throw e; // p. ej. lector no disponible: no se guarda nada
    const issue: ValidationIssue = { code: "extraction_failed", severity: "review", message: `No se pudo leer el ticket: ${e.message}` };
    const id = insertExpense(db, ExtractedReceiptSchema.parse({}), {
      hash, status: "review", reviewReason: issue.message, itemsReconciled: false,
      imagePath: saveImage(o.imagesDir, hash, data, null), rawJson: { error: e.message }, source: o.source,
    });
    return { status: "review", expenseId: id, issues: [issue], itemsReconciled: false, itemsDiff: null, duplicateOf: null, probableDuplicates: [] };
  }

  const { receipt, meta } = extraction;
  const items = validateItems(receipt);
  const issues = [...validateHeader(receipt, o.today), ...items.issues];
  const { status, reason } = decideStatus(issues);

  const probable = findProbableDuplicates(db, receipt.vendor, receipt.expense_date, receipt.total_amount);
  if (probable.length) {
    issues.push({ code: "probable_duplicate", severity: "warn", message: `Parece repetido: mismo proveedor, fecha e importe que el ticket ${probable.join(", ")}.` });
  }

  const id = insertExpense(db, receipt, {
    hash, status, reviewReason: reason, itemsReconciled: items.reconciled,
    imagePath: saveImage(o.imagesDir, hash, data, receipt.expense_date), rawJson: meta, source: o.source,
  });
  return { status, expenseId: id, issues, itemsReconciled: items.reconciled, itemsDiff: items.diff, duplicateOf: null, probableDuplicates: probable };
}
