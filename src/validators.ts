// Reglas deterministas. Funciones puras: la IA nunca valida cifras.
import { PRODUCT_CATEGORIES, TICKET_CATEGORIES } from "./config.js";
import type { ExtractedReceipt, ValidationIssue, Severity } from "./models.js";

export const TOL_HEADER = 0.02;
export const TOL_LINE = 0.02;
export const TOL_SUM = 0.05;
export const MAX_AMOUNT = 10_000;
export const MAX_AGE_DAYS = 400;
export const MIN_CONFIDENCE = 0.75;

export const close = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol + 1e-9;
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Fecha de hoy (aaaa-mm-dd) en Europe/Madrid. */
export function todayMadrid(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
}

function parseIso(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

const issue = (code: string, severity: Severity, message: string, line_no?: number): ValidationIssue =>
  line_no === undefined ? { code, severity, message } : { code, severity, message, line_no };

export function validateHeader(r: ExtractedReceipt, today: string = todayMadrid()): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  if (r.total_amount === null) {
    out.push(issue("total_missing", "block", "No se ha leído el total."));
  } else {
    if (r.base_amount !== null && r.vat_amount !== null && !close(r.base_amount + r.vat_amount, r.total_amount, TOL_HEADER)) {
      out.push(issue("base_vat_total", "block", "Base + IVA no coincide con el total."));
    }
    if (r.vat_amount !== null && r.vat_amount > r.total_amount) {
      out.push(issue("vat_gt_total", "block", "El IVA supera el total."));
    }
    if (r.total_amount > MAX_AMOUNT) {
      out.push(issue("amount_high", "review", "Importe superior a 10.000: revisar."));
    }
  }

  if (r.expense_date === null) {
    out.push(issue("date_missing", "review", "No se ha leído la fecha."));
  } else {
    const d = parseIso(r.expense_date);
    const t = parseIso(today);
    if (d === null || t === null) {
      out.push(issue("date_invalid", "block", "Fecha no válida."));
    } else if (d > t) {
      out.push(issue("date_future", "block", "La fecha es futura."));
    } else if ((t - d) / 86_400_000 > MAX_AGE_DAYS) {
      out.push(issue("date_old", "warn", "El ticket tiene más de 400 días."));
    }
  }
  if (r.date_ambiguous) out.push(issue("date_ambiguous", "review", "Fecha ambigua (dd/mm o mm/dd)."));

  if (r.category === null || !(TICKET_CATEGORIES as readonly string[]).includes(r.category)) {
    out.push(issue("category_invalid", "block", "Categoría fuera de la lista."));
  }
  if (r.confidence !== null && r.confidence < MIN_CONFIDENCE) {
    out.push(issue("low_confidence", "review", "Confianza baja en la lectura."));
  }
  return out;
}

export interface ItemsValidation {
  issues: ValidationIssue[];
  reconciled: boolean;
  diff: number | null; // total - suma de líneas
}

export function validateItems(r: ExtractedReceipt): ItemsValidation {
  const issues: ValidationIssue[] = [];
  if (r.items.length === 0) {
    issues.push(issue("no_items", "warn", "No se han leído líneas."));
    return { issues, reconciled: false, diff: null };
  }

  r.items.forEach((it, idx) => {
    const n = idx + 1;
    if (it.quantity !== null && it.unit_price !== null && it.line_total !== null) {
      const expected = it.quantity * it.unit_price - (it.discount ?? 0);
      if (!close(expected, it.line_total, TOL_LINE)) {
        issues.push(issue("line_mismatch", "warn", `Línea ${n}: cantidad × precio − descuento no cuadra.`, n));
      }
    }
    if (it.product_category !== null && !(PRODUCT_CATEGORIES as readonly string[]).includes(it.product_category)) {
      issues.push(issue("item_category_invalid", "warn", `Línea ${n}: categoría de producto fuera de la lista.`, n));
    }
  });

  if (r.total_amount === null || r.items.some((it) => it.line_total === null)) {
    issues.push(issue("items_incomplete", "warn", "Faltan importes en líneas o total."));
    return { issues, reconciled: false, diff: null };
  }

  const sum = r.items.reduce((acc, it) => acc + (it.line_total ?? 0), 0);
  const diff = round2(r.total_amount - sum);
  const reconciled = close(diff, 0, TOL_SUM);
  if (!reconciled) {
    issues.push(issue("items_dont_add_up", "warn", `Líneas dudosas: faltan ${diff.toFixed(2)} para cuadrar con el total.`));
  }
  return { issues, reconciled, diff };
}

/** Bloqueos y revisiones obligatorias van a 'review'. Las líneas dudosas y los avisos NO bloquean. */
export function decideStatus(issues: ValidationIssue[]): { status: "pending" | "review"; reason: string | null } {
  const reasons = issues.filter((i) => i.severity === "block" || i.severity === "review").map((i) => i.message);
  return reasons.length ? { status: "review", reason: reasons.join(" | ") } : { status: "pending", reason: null };
}
