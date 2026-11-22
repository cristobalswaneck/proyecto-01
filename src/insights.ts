// Consultas de análisis, calculadas con SQL. Solo tickets confirmados y en EUR;
// el consumo por producto usa además solo tickets con líneas cuadradas.
import type { DB } from "./db.js";

const BASE = "status = 'confirmed' AND currency = 'EUR'";

export interface Overview {
  confirmed: number;
  pending: number;
  review: number;
  eurConfirmed: number;
  excludedNonEur: number;
  excludedUnreconciled: number;
}

export function overview(db: DB): Overview {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    confirmed: count("SELECT COUNT(*) n FROM expenses WHERE status = 'confirmed'"),
    pending: count("SELECT COUNT(*) n FROM expenses WHERE status = 'pending'"),
    review: count("SELECT COUNT(*) n FROM expenses WHERE status = 'review'"),
    eurConfirmed: count(`SELECT COUNT(*) n FROM expenses WHERE ${BASE}`),
    excludedNonEur: count("SELECT COUNT(*) n FROM expenses WHERE status = 'confirmed' AND currency IS NOT 'EUR'"),
    excludedUnreconciled: count(`SELECT COUNT(*) n FROM expenses WHERE ${BASE} AND items_reconciled = 0`),
  };
}

export interface MonthlyCategory { month: string; category: string; total: number; tickets: number }

export function monthlyByCategory(db: DB): MonthlyCategory[] {
  return db.prepare(
    `SELECT substr(expense_date, 1, 7) AS month, COALESCE(category, 'Otros') AS category,
            ROUND(SUM(total_amount), 2) AS total, COUNT(*) AS tickets
     FROM expenses WHERE ${BASE} AND expense_date IS NOT NULL
     GROUP BY month, category ORDER BY month, category`,
  ).all() as MonthlyCategory[];
}

export interface VendorTotal { vendor: string; total: number; tickets: number; avgTicket: number }

export function topVendors(db: DB, limit = 10): VendorTotal[] {
  return db.prepare(
    `SELECT COALESCE(vendor_normalized, vendor, '(sin nombre)') AS vendor,
            ROUND(SUM(total_amount), 2) AS total, COUNT(*) AS tickets,
            ROUND(AVG(total_amount), 2) AS avgTicket
     FROM expenses WHERE ${BASE}
     GROUP BY vendor ORDER BY total DESC LIMIT ?`,
  ).all(limit) as VendorTotal[];
}

export interface ProductSummary { product: string; purchases: number; lastDate: string }

/** Productos con al menos una compra utilizable (confirmada, EUR, líneas cuadradas). */
export function products(db: DB): ProductSummary[] {
  return db.prepare(
    `SELECT i.product_normalized AS product, COUNT(*) AS purchases, MAX(e.expense_date) AS lastDate
     FROM expense_items i JOIN expenses e ON e.id = i.expense_id
     WHERE e.${BASE.replaceAll(" AND ", " AND e.")} AND e.items_reconciled = 1
       AND i.product_normalized IS NOT NULL AND i.quantity > 0 AND i.line_total IS NOT NULL
     GROUP BY i.product_normalized ORDER BY purchases DESC, product LIMIT 500`,
  ).all() as ProductSummary[];
}

export interface PricePoint { date: string; vendor: string; unit: string; price: number }
export interface UnitChange { unit: string; first: number; last: number; changePct: number; points: number }
export interface PriceHistory { product: string; points: PricePoint[]; byUnit: UnitChange[] }

/** Evolución del precio unitario efectivo (descuento incluido) de un producto. */
export function priceHistory(db: DB, product: string): PriceHistory {
  const points = db.prepare(
    `SELECT e.expense_date AS date, COALESCE(e.vendor_normalized, e.vendor, '(sin nombre)') AS vendor,
            COALESCE(i.unit, 'ud') AS unit, ROUND(i.line_total * 1.0 / i.quantity, 4) AS price
     FROM expense_items i JOIN expenses e ON e.id = i.expense_id
     WHERE e.status = 'confirmed' AND e.currency = 'EUR' AND e.items_reconciled = 1
       AND i.product_normalized = ? AND i.quantity > 0 AND i.line_total IS NOT NULL
       AND e.expense_date IS NOT NULL
     ORDER BY e.expense_date, e.id`,
  ).all(product) as PricePoint[];

  // La unidad no se mezcla: el precio por kg no es comparable con el precio por unidad.
  const byUnit: UnitChange[] = [];
  for (const unit of [...new Set(points.map((p) => p.unit))]) {
    const series = points.filter((p) => p.unit === unit);
    const first = series[0]!.price;
    const last = series[series.length - 1]!.price;
    byUnit.push({
      unit, first, last, points: series.length,
      changePct: first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : 0,
    });
  }
  return { product, points, byUnit };
}
