import { describe, expect, it } from "vitest";
import { DuplicateFileError, fileHash, findProbableDuplicates, getIdByHash, insertExpense, listReceipts, openDb, setStatus } from "../src/db.js";
import { goodReceipt, item, memDb, tmpDir } from "./helpers.js";
import path from "node:path";

const save = (db = memDb(), hash = "h1", r = goodReceipt()) =>
  ({ db, id: insertExpense(db, r, { hash, status: "pending", reviewReason: null, itemsReconciled: true, rawJson: { usage: { input_tokens: 1 } } }) });

describe("esquema", () => {
  it("crea tablas e índices, WAL y claves foráneas; es idempotente", () => {
    const file = path.join(tmpDir(), "t.db");
    openDb(file).close();
    const db = openDb(file);
    const names = (t: string) => (db.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(t) as { name: string }[]).map((r) => r.name);
    expect(names("table")).toEqual(expect.arrayContaining(["expenses", "expense_items", "vendor_aliases", "product_aliases"]));
    expect(names("index")).toEqual(expect.arrayContaining(["idx_expenses_vendor_date_total", "idx_expenses_status", "idx_expenses_date", "idx_items_expense", "idx_items_product"]));
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  });
  it("las listas cerradas se aplican en la base", () => {
    const db = memDb();
    const ins = (cat: string, status = "pending", hash = Math.random().toString()) =>
      db.prepare("INSERT INTO expenses (file_hash, category, status) VALUES (?,?,?)").run(hash, cat, status);
    expect(() => ins("Inventada")).toThrow();
    expect(() => ins("Otros", "hecho")).toThrow();
    expect(() => ins("Otros")).not.toThrow();
  });
});

describe("guardado", () => {
  it("guarda cabecera y líneas; una categoría de producto inválida se guarda como null", () => {
    const r = goodReceipt();
    r.items[1]!.product_category = "Inventada";
    const { db, id } = save(memDb(), "h1", r);
    const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row.vendor).toBe("Mercadona");
    expect(row.raw_json).toContain("input_tokens");
    const items = db.prepare("SELECT line_no, product_category FROM expense_items WHERE expense_id = ? ORDER BY line_no").all(id);
    expect(items).toEqual([{ line_no: 1, product_category: null }, { line_no: 2, product_category: null }]);
  });
  it("el mismo archivo no se guarda dos veces", () => {
    const { db, id } = save();
    expect(() => save(db)).toThrow(DuplicateFileError);
    expect((db.prepare("SELECT COUNT(*) n FROM expenses").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM expense_items").get() as { n: number }).n).toBe(2);
    expect(getIdByHash(db, "h1")).toBe(id);
    expect(getIdByHash(db, "nope")).toBeNull();
  });
  it("si falla una línea se revierte también la cabecera", () => {
    const db = memDb();
    const bad = goodReceipt();
    bad.items[1]!.unit = "caja" as never; // la 2.ª línea viola el CHECK de unidad
    expect(() => insertExpense(db, bad, { hash: "z", status: "pending", reviewReason: null, itemsReconciled: false })).toThrow();
    expect((db.prepare("SELECT COUNT(*) n FROM expenses").get() as { n: number }).n).toBe(0);
  });
  it("hash SHA-256 estable", () => {
    expect(fileHash(Buffer.from("abc"))).toHaveLength(64);
    expect(fileHash(Buffer.from("abc"))).toBe(fileHash(Buffer.from("abc")));
    expect(fileHash(Buffer.from("abc"))).not.toBe(fileHash(Buffer.from("abd")));
  });
});

describe("duplicados probables", () => {
  it("mismo comercio, fecha e importe; ignora mayúsculas y rechazados", () => {
    const { db, id } = save(memDb(), "a");
    expect(findProbableDuplicates(db, "mercadona", "2026-10-01", 9)).toEqual([id]);
    expect(findProbableDuplicates(db, "Mercadona", "2026-10-02", 9)).toEqual([]);
    expect(findProbableDuplicates(db, "Mercadona", "2026-10-01", 9.5)).toEqual([]);
    expect(findProbableDuplicates(db, "Mercadona", "2026-10-01", 9, id)).toEqual([]);
    expect(findProbableDuplicates(db, null, "2026-10-01", 9)).toEqual([]);
    setStatus(db, id, "rejected");
    expect(findProbableDuplicates(db, "Mercadona", "2026-10-01", 9)).toEqual([]);
  });
});

describe("listado", () => {
  it("filtra por estado, mes y comercio; el comodín % no es un comodín", () => {
    const db = memDb();
    save(db, "a", goodReceipt({ vendor: "Mercadona", expense_date: "2026-09-10" }));
    save(db, "b", goodReceipt({ vendor: "Lidl", expense_date: "2026-10-10" }));
    expect(listReceipts(db, { month: "2026-09" }).map((r) => r.vendor)).toEqual(["Mercadona"]);
    expect(listReceipts(db, { q: "lid" }).map((r) => r.vendor)).toEqual(["Lidl"]);
    expect(listReceipts(db, { q: "%" })).toEqual([]);
    expect(listReceipts(db, { status: "confirmed" })).toEqual([]);
    expect(listReceipts(db).map((r) => r.vendor)).toEqual(["Lidl", "Mercadona"]);
  });
});
