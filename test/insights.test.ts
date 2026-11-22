import { describe, expect, it } from "vitest";
import { insertExpense, setStatus, type DB } from "../src/db.js";
import * as insights from "../src/insights.js";
import { goodReceipt, item, memDb } from "./helpers.js";

let n = 0;
function add(db: DB, o: { vendor?: string; date: string; price: number; qty?: number; unit?: "ud" | "kg" | "l"; currency?: string; reconciled?: boolean; confirmed?: boolean; product?: string; category?: string }) {
  const qty = o.qty ?? 1;
  const total = Math.round(qty * o.price * 100) / 100;
  const r = goodReceipt({
    vendor: o.vendor ?? "Mercadona", expense_date: o.date, currency: o.currency ?? "EUR", total_amount: total,
    category: o.category ?? "Alimentación",
    items: [item({ product_normalized: o.product ?? "Leche entera", quantity: qty, unit: o.unit ?? "ud", unit_price: o.price, line_total: total })],
  });
  const id = insertExpense(db, r, { hash: `h${n++}`, status: "pending", reviewReason: null, itemsReconciled: o.reconciled ?? true });
  if (o.confirmed ?? true) setStatus(db, id, "confirmed");
  return id;
}

describe("análisis", () => {
  it("gasto mensual por categoría: solo confirmados y en EUR", () => {
    const db = memDb();
    add(db, { date: "2026-09-05", price: 10 });
    add(db, { date: "2026-09-20", price: 5, category: "Ocio" });
    add(db, { date: "2026-10-02", price: 7 });
    add(db, { date: "2026-09-06", price: 99, currency: "GBP" }); // otra moneda: fuera
    add(db, { date: "2026-09-07", price: 88, confirmed: false }); // sin confirmar: fuera
    const rows = insights.monthlyByCategory(db);
    expect(rows).toEqual([
      { month: "2026-09", category: "Alimentación", total: 10, tickets: 1 },
      { month: "2026-09", category: "Ocio", total: 5, tickets: 1 },
      { month: "2026-10", category: "Alimentación", total: 7, tickets: 1 },
    ]);
  });
  it("el resumen informa de lo que excluye", () => {
    const db = memDb();
    add(db, { date: "2026-09-05", price: 10 });
    add(db, { date: "2026-09-06", price: 10, currency: "GBP" });
    add(db, { date: "2026-09-07", price: 10, reconciled: false });
    add(db, { date: "2026-09-08", price: 10, confirmed: false });
    expect(insights.overview(db)).toEqual({ confirmed: 3, pending: 1, review: 0, eurConfirmed: 2, excludedNonEur: 1, excludedUnreconciled: 1 });
  });
  it("comercios: total, nº de tickets y ticket medio", () => {
    const db = memDb();
    add(db, { vendor: "Lidl", date: "2026-09-05", price: 10 });
    add(db, { vendor: "Lidl", date: "2026-09-06", price: 20 });
    add(db, { vendor: "Mercadona", date: "2026-09-06", price: 5 });
    expect(insights.topVendors(db)).toEqual([
      { vendor: "Lidl", total: 30, tickets: 2, avgTicket: 15 },
      { vendor: "Mercadona", total: 5, tickets: 1, avgTicket: 5 },
    ]);
  });
  it("evolución del precio: cambio porcentual entre la primera y la última compra", () => {
    const db = memDb();
    add(db, { date: "2026-01-10", price: 1.0 });
    add(db, { date: "2026-06-10", price: 1.1, vendor: "Lidl" });
    add(db, { date: "2026-10-10", price: 1.25 });
    const h = insights.priceHistory(db, "Leche entera");
    expect(h.points.map((p) => p.price)).toEqual([1, 1.1, 1.25]);
    expect(h.byUnit).toEqual([{ unit: "ud", first: 1, last: 1.25, changePct: 25, points: 3 }]);
  });
  it("el precio usa el total de línea (descuento incluido) y no mezcla unidades", () => {
    const db = memDb();
    add(db, { date: "2026-01-10", price: 2.5, qty: 2, unit: "kg", product: "Manzana" });
    add(db, { date: "2026-02-10", price: 3, unit: "ud", product: "Manzana" });
    const h = insights.priceHistory(db, "Manzana");
    expect(h.byUnit.map((u) => u.unit).sort()).toEqual(["kg", "ud"]);
    expect(h.points.find((p) => p.unit === "kg")?.price).toBe(2.5);
  });
  it("los productos de tickets con líneas sin cuadrar o en otra moneda no cuentan", () => {
    const db = memDb();
    add(db, { date: "2026-01-10", price: 1, product: "A" });
    add(db, { date: "2026-01-10", price: 1, product: "B", reconciled: false });
    add(db, { date: "2026-01-10", price: 1, product: "C", currency: "USD" });
    expect(insights.products(db).map((p) => p.product)).toEqual(["A"]);
    expect(insights.priceHistory(db, "B").points).toEqual([]);
  });
});
