"""bytes de imagen -> PipelineResult. No sabe nada de Telegram."""
import os
import sqlite3
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path

from gastos import db, validators
from gastos.extractor import ExtractionError
from gastos.models import ExtractedReceipt, PipelineResult, ValidationIssue

# extract_fn: bytes -> (ExtractedReceipt, meta). Se inyecta para poder probar sin API.
ExtractFn = Callable[[bytes], tuple[ExtractedReceipt, dict]]


def _save_image(images_dir: Path, h: str, data: bytes, expense_date: str | None) -> str:
    """Guarda el original en <images_dir>/<año>/<mes>/<hash>.bin con permisos 600."""
    try:
        d = date.fromisoformat(expense_date) if expense_date else datetime.now().date()
    except ValueError:
        d = datetime.now().date()
    folder = images_dir / f"{d.year:04d}" / f"{d.month:02d}"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{h[:16]}.img"
    path.write_bytes(data)
    os.chmod(path, 0o600)
    return str(path)


def process_image(conn: sqlite3.Connection, data: bytes, *, extract_fn: ExtractFn,
                  images_dir: Path, source: str = "cli",
                  today: date | None = None) -> PipelineResult:
    h = db.file_hash(data)
    existing = db.get_id_by_hash(conn, h)
    if existing is not None:
        return PipelineResult(status="rejected", duplicate_of=existing, issues=[ValidationIssue(
            code="duplicate_file", severity="block",
            message=f"Este ticket ya estaba registrado (id {existing}).")])

    try:
        receipt, meta = extract_fn(data)
    except ExtractionError as e:
        # Si el JSON no valida tras el reintento, el ticket va a revisión.
        issue = ValidationIssue(code="extraction_failed", severity="review",
                                message=f"No se pudo leer el ticket: {e}")
        path = _save_image(images_dir, h, data, None)
        eid = db.insert_expense(conn, ExtractedReceipt(), h=h, status="review",
                                review_reason=issue.message, items_reconciled=False,
                                image_path=path, raw_json={"error": str(e)}, source=source)
        return PipelineResult(status="review", expense_id=eid, issues=[issue])

    issues = validators.validate_header(receipt, today)
    item_issues, reconciled, diff = validators.validate_items(receipt)
    issues += item_issues
    status, reason = validators.decide_status(issues)

    probable = db.find_probable_duplicates(conn, receipt.vendor, receipt.expense_date,
                                           receipt.total_amount)
    if probable:
        issues.append(ValidationIssue(
            code="probable_duplicate", severity="warn",
            message=f"Parece repetido: mismo proveedor, fecha e importe que el ticket {probable}."))

    path = _save_image(images_dir, h, data, receipt.expense_date)
    eid = db.insert_expense(conn, receipt, h=h, status=status, review_reason=reason,
                            items_reconciled=reconciled, image_path=path, raw_json=meta,
                            source=source)
    return PipelineResult(status=status, expense_id=eid, issues=issues,
                          items_reconciled=reconciled, items_diff=diff,
                          probable_duplicates=probable)
