// SQLite con SQL explícito (sin ORM).
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PRODUCT_CATEGORIES, TICKET_CATEGORIES, type Status } from "./config.js";
import type { ExtractedReceipt } from "./models.js";
import { SCHEMA } from "./schema.js";

export type DB = Database.Database;

export class DuplicateFileError extends Error {
  constructor(public readonly expenseId: number) {
    super(`Ticket ya registrado (id ${expenseId})`);
  }
}

/** Abre la base con WAL y claves foráneas, y crea el esquema si falta (idempotente). */
export function openDb(dbPath: string): DB {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export const fileHash = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

export function getIdByHash(db: DB, hash: string): number | null {
  const row = db.prepare("SELECT id FROM expenses WHERE file_hash = ?").get(hash) as { id: number } | undefined;
  return row?.id ?? null;
}

/** Mismo proveedor, fecha e importe (sin distinguir mayúsculas). Los rechazados no cuentan. */
export function findProbableDuplicates(
  db: DB, vendor: string | null, date: string | null, total: number | null, excludeId: number | null = null,
): number[] {
  if (vendor === null || date === null || total === null) return [];
  const rows = db.prepare(
    `SELECT id FROM expenses
     WHERE vendor = ? COLLATE NOCASE AND expense_date = ? AND ABS(total_amount - ?) < 0.005
       AND status != 'rejected' AND id IS NOT ?
     ORDER BY id`,
  ).all(vendor, date, total, excludeId) as { id: number }[];
  return rows.map((r) => r.id);
}

const onlyIf = (v: string | null, allowed: readonly string[]): string | null =>
  v !== null && allowed.includes(v) ? v : null;

export interface InsertOptions {
  hash: string;
  status: Status;
  reviewReason: string | null;
  itemsReconciled: boolean;
  imagePath?: string | null;
  rawJson?: unknown;
  source?: string;
}

/** Inserta cabecera y líneas en una transacción. Lanza DuplicateFileError si el hash ya existe. */
export function insertExpense(db: DB, r: ExtractedReceipt, o: InsertOptions): number {
  const existing = getIdByHash(db, o.hash);
  if (existing !== null) throw new DuplicateFileError(existing);

  const insertHeader = db.prepare(
    `INSERT INTO expenses (file_hash, vendor, vendor_normalized, expense_date, date_ambiguous,
       purchase_time, base_amount, vat_amount, total_amount, currency, category, payment_method,
       status, items_reconciled, confidence, review_reason, image_path, raw_json, source)
     VALUES (@hash, @vendor, @vendor, @date, @amb, @time, @base, @vat, @total, @cur, @cat, @pay,
       @status, @rec, @conf, @reason, @image, @raw, @source)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO expense_items (expense_id, line_no, raw_description, product_normalized,
       product_category, quantity, unit, unit_price, discount, line_total)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  const tx = db.transaction((): number => {
    const res = insertHeader.run({
      hash: o.hash, vendor: r.vendor, date: r.expense_date, amb: r.date_ambiguous ? 1 : 0,
      time: r.purchase_time, base: r.base_amount, vat: r.vat_amount, total: r.total_amount,
      cur: r.currency, cat: onlyIf(r.category, TICKET_CATEGORIES), pay: r.payment_method,
      status: o.status, rec: o.itemsReconciled ? 1 : 0, conf: r.confidence, reason: o.reviewReason,
      image: o.imagePath ?? null, raw: o.rawJson === undefined ? null : JSON.stringify(o.rawJson),
      source: o.source ?? "web",
    });
    const id = Number(res.lastInsertRowid);
    r.items.forEach((it, i) => {
      insertItem.run(id, i + 1, it.raw_description, it.product_normalized,
        onlyIf(it.product_category, PRODUCT_CATEGORIES), it.quantity, it.unit, it.unit_price,
        it.discount, it.line_total);
    });
    return id;
  });
  return tx();
}

export interface ExpenseRow {
  id: number; vendor: string | null; vendor_normalized: string | null; expense_date: string | null;
  date_ambiguous: number; purchase_time: string | null; base_amount: number | null;
  vat_amount: number | null; total_amount: number | null; currency: string | null;
  category: string | null; payment_method: string | null; status: Status; items_reconciled: number;
  confidence: number | null; review_reason: string | null; image_path: string | null;
  source: string | null; created_at: string; confirmed_at: string | null;
}

export interface ItemRow {
  id: number; expense_id: number; line_no: number; raw_description: string | null;
  product_normalized: string | null; product_category: string | null; quantity: number | null;
  unit: string | null; unit_price: number | null; discount: number | null; line_total: number | null;
}

const HEADER_COLUMNS = `id, vendor, vendor_normalized, expense_date, date_ambiguous, purchase_time,
  base_amount, vat_amount, total_amount, currency, category, payment_method, status, items_reconciled,
  confidence, review_reason, image_path, source, created_at, confirmed_at`;

export interface ListFilters { status?: string; category?: string; month?: string; q?: string; limit?: number }

export function listReceipts(db: DB, f: ListFilters = {}): ExpenseRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) { where.push("status = ?"); params.push(f.status); }
  if (f.category) { where.push("category = ?"); params.push(f.category); }
  if (f.month) { where.push("substr(expense_date, 1, 7) = ?"); params.push(f.month); }
  if (f.q) { where.push("vendor LIKE ? ESCAPE '\\'"); params.push(`%${f.q.replace(/[\\%_]/g, "\\$&")}%`); }
  const sql = `SELECT ${HEADER_COLUMNS} FROM expenses ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY COALESCE(expense_date, created_at) DESC, id DESC LIMIT ?`;
  return db.prepare(sql).all(...params, Math.min(f.limit ?? 200, 500)) as ExpenseRow[];
}

export function getReceipt(db: DB, id: number): { expense: ExpenseRow; items: ItemRow[] } | null {
  const expense = db.prepare(`SELECT ${HEADER_COLUMNS} FROM expenses WHERE id = ?`).get(id) as ExpenseRow | undefined;
  if (!expense) return null;
  const items = db.prepare("SELECT * FROM expense_items WHERE expense_id = ? ORDER BY line_no").all(id) as ItemRow[];
  return { expense, items };
}

export function setStatus(db: DB, id: number, status: Status): void {
  db.prepare(
    "UPDATE expenses SET status = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE NULL END WHERE id = ?",
  ).run(status, status, id);
}

export function setCategory(db: DB, id: number, category: string): void {
  db.prepare("UPDATE expenses SET category = ? WHERE id = ?").run(category, id);
}
