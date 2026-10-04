"""Reglas deterministas. Funciones puras: la IA nunca valida cifras."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from gastos import config
from gastos.models import ExtractedReceipt, ValidationIssue

TZ = ZoneInfo("Europe/Madrid")
TOL_HEADER = 0.02
TOL_LINE = 0.02
TOL_SUM = 0.05
MAX_AMOUNT = 10_000
MAX_AGE_DAYS = 400
MIN_CONFIDENCE = 0.75


def close(a: float, b: float, tol: float) -> bool:
    return abs(a - b) <= tol + 1e-9


def _issue(code, severity, message, line_no=None):
    return ValidationIssue(code=code, severity=severity, message=message, line_no=line_no)


def validate_header(r: ExtractedReceipt, today: date | None = None) -> list[ValidationIssue]:
    today = today or datetime.now(TZ).date()
    out: list[ValidationIssue] = []

    if r.total_amount is None:
        out.append(_issue("total_missing", "block", "No se ha leído el total."))
    else:
        if r.base_amount is not None and r.vat_amount is not None \
                and not close(r.base_amount + r.vat_amount, r.total_amount, TOL_HEADER):
            out.append(_issue("base_vat_total", "block", "Base + IVA no coincide con el total."))
        if r.vat_amount is not None and r.vat_amount > r.total_amount:
            out.append(_issue("vat_gt_total", "block", "El IVA supera el total."))
        if r.total_amount > MAX_AMOUNT:
            out.append(_issue("amount_high", "review", "Importe superior a 10.000: revisar."))

    if r.expense_date is None:
        out.append(_issue("date_missing", "review", "No se ha leído la fecha."))
    else:
        try:
            d = date.fromisoformat(r.expense_date)
        except ValueError:
            out.append(_issue("date_invalid", "block", "Fecha no válida."))
        else:
            if d > today:
                out.append(_issue("date_future", "block", "La fecha es futura."))
            elif (today - d).days > MAX_AGE_DAYS:
                out.append(_issue("date_old", "warn", "El ticket tiene más de 400 días."))
    if r.date_ambiguous:
        out.append(_issue("date_ambiguous", "review", "Fecha ambigua (dd/mm o mm/dd)."))

    if r.category not in config.TICKET_CATEGORIES:
        out.append(_issue("category_invalid", "block", "Categoría fuera de la lista."))
    if r.confidence is not None and r.confidence < MIN_CONFIDENCE:
        out.append(_issue("low_confidence", "review", "Confianza baja en la lectura."))
    return out


def validate_items(r: ExtractedReceipt) -> tuple[list[ValidationIssue], bool, float | None]:
    """Devuelve (avisos, items_reconciled, total - suma de líneas)."""
    out: list[ValidationIssue] = []
    if not r.items:
        out.append(_issue("no_items", "warn", "No se han leído líneas."))
        return out, False, None

    for n, it in enumerate(r.items, start=1):
        if None not in (it.quantity, it.unit_price, it.line_total):
            expected = it.quantity * it.unit_price - (it.discount or 0)
            if not close(expected, it.line_total, TOL_LINE):
                out.append(_issue("line_mismatch", "warn",
                                  f"Línea {n}: cantidad × precio − descuento no cuadra.", n))
        if it.product_category is not None and it.product_category not in config.PRODUCT_CATEGORIES:
            out.append(_issue("item_category_invalid", "warn",
                              f"Línea {n}: categoría de producto fuera de la lista.", n))

    if r.total_amount is None or any(it.line_total is None for it in r.items):
        out.append(_issue("items_incomplete", "warn", "Faltan importes en líneas o total."))
        return out, False, None

    diff = round(r.total_amount - sum(it.line_total for it in r.items), 2)
    reconciled = close(diff, 0, TOL_SUM)
    if not reconciled:
        out.append(_issue("items_dont_add_up", "warn",
                          f"Líneas dudosas: faltan {diff:.2f} para cuadrar con el total."))
    return out, reconciled, diff


def decide_status(issues: list[ValidationIssue]) -> tuple[str, str | None]:
    """Bloqueos y revisiones obligatorias van a 'review'; si no, 'pending'.
    Las líneas dudosas y los avisos NO bloquean."""
    reasons = [i.message for i in issues if i.severity in ("block", "review")]
    if reasons:
        return "review", " | ".join(reasons)
    return "pending", None
