import { describe, expect, it } from "vitest";
import { decideStatus, validateHeader, validateItems } from "../src/validators.js";
import { item, receipt } from "./helpers.js";

const TODAY = "2026-10-04";
const codes = (xs: { code: string }[]) => new Set(xs.map((x) => x.code));
const header = (o = {}) => codes(validateHeader(receipt(o), TODAY));

describe("cabecera", () => {
  it("un ticket limpio no tiene avisos", () => {
    expect(validateHeader(receipt({ base_amount: 9.09, vat_amount: 0.91 }), TODAY)).toEqual([]);
  });
  it("base + IVA = total, con tolerancia 0,02 y solo si ambos aparecen", () => {
    expect(header({ base_amount: 8, vat_amount: 1 })).toContain("base_vat_total");
    expect(header({ base_amount: 9.08, vat_amount: 0.91 })).not.toContain("base_vat_total");
    expect(header({ base_amount: 5 })).not.toContain("base_vat_total");
  });
  it("el IVA no supera el total", () => expect(header({ vat_amount: 11 })).toContain("vat_gt_total"));
  it("fechas: futura bloquea, antigua avisa, inválida y ausente", () => {
    expect(header({ expense_date: "2026-10-05" })).toContain("date_future");
    expect(header({ expense_date: "2026-10-04" })).not.toContain("date_future");
    expect(header({ expense_date: "2025-08-01" })).toContain("date_old");
    expect(header({ expense_date: "2026-13-40" })).toContain("date_invalid");
    expect(header({ expense_date: "2026-02-30" })).toContain("date_invalid");
    expect(header({ expense_date: null })).toContain("date_missing");
    expect(header({ date_ambiguous: true })).toContain("date_ambiguous");
  });
  it("categoría, importe alto, confianza y total ausente", () => {
    expect(header({ category: "Comida" })).toContain("category_invalid");
    expect(header({ category: null })).toContain("category_invalid");
    expect(header({ total_amount: 10_000.01 })).toContain("amount_high");
    expect(header({ total_amount: 10_000 })).not.toContain("amount_high");
    expect(header({ confidence: 0.7 })).toContain("low_confidence");
    expect(header({ total_amount: null })).toContain("total_missing");
  });
});

describe("líneas", () => {
  it("cantidad × precio − descuento y marca la línea que falla", () => {
    const ok = item({ quantity: 2, unit_price: 1.5, discount: 0.5, line_total: 2.5 });
    const bad = item({ quantity: 2, unit_price: 1.5, line_total: 2 });
    const { issues } = validateItems(receipt({ total_amount: 4.5, items: [ok, bad] }));
    expect(issues.filter((i) => i.code === "line_mismatch").map((i) => i.line_no)).toEqual([2]);
  });
  it("producto al peso", () => {
    const it = item({ quantity: 0.532, unit: "kg", unit_price: 12.9, line_total: 6.86 });
    const r = validateItems(receipt({ total_amount: 6.86, items: [it] }));
    expect(r.reconciled).toBe(true);
    expect(r.issues).toEqual([]);
  });
  it("cuadra dentro de 0,05 y no cuadra fuera", () => {
    const items = [item({ line_total: 4 }), item({ line_total: 5 })];
    expect(validateItems(receipt({ total_amount: 9.04, items })).reconciled).toBe(true);
    const r = validateItems(receipt({ total_amount: 13.1, items }));
    expect(r.reconciled).toBe(false);
    expect(r.diff).toBe(4.1);
    expect(codes(r.issues)).toContain("items_dont_add_up");
  });
  it("líneas incompletas o ausentes", () => {
    expect(validateItems(receipt({ items: [item({ line_total: null })] }))).toMatchObject({ reconciled: false, diff: null });
    const r = validateItems(receipt({ items: [] }));
    expect(r.reconciled).toBe(false);
    expect(codes(r.issues)).toContain("no_items");
  });
  it("categoría de producto fuera de la lista avisa en esa línea", () => {
    const { issues } = validateItems(receipt({ total_amount: 1, items: [item({ product_category: "Inventada", line_total: 1 })] }));
    expect(issues.find((i) => i.code === "item_category_invalid")?.line_no).toBe(1);
  });
});

describe("estado", () => {
  it("las líneas que no cuadran no bloquean", () => {
    const issues = [...validateHeader(receipt(), TODAY), ...validateItems(receipt({ items: [item({ line_total: 1 })] })).issues];
    expect(decideStatus(issues)).toEqual({ status: "pending", reason: null });
  });
  it("bloqueos y revisiones obligatorias van a review", () => {
    const a = decideStatus(validateHeader(receipt({ date_ambiguous: true }), TODAY));
    expect(a.status).toBe("review");
    expect(a.reason).toContain("ambigua");
    expect(decideStatus(validateHeader(receipt({ category: "x" }), TODAY)).status).toBe("review");
    expect(decideStatus(validateHeader(receipt({ expense_date: "2025-01-01" }), TODAY)).status).toBe("pending");
  });
});
