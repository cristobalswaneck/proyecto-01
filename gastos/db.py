"""SQLite con SQL explícito (sin ORM)."""
import hashlib
import json
import sqlite3
from pathlib import Path

from gastos import config
from gastos.models import ExtractedReceipt

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema.sql"


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Abre una conexión con WAL y claves foráneas activadas."""
    if str(db_path) != ":memory:":
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(db_path: str | Path) -> sqlite3.Connection:
    """Crea la base si no existe. Es idempotente."""
    conn = connect(db_path)
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()
    return conn


class DuplicateFileError(Exception):
    """El mismo archivo (hash) ya está registrado."""

    def __init__(self, expense_id: int):
        super().__init__(f"Ticket ya registrado (id {expense_id})")
        self.expense_id = expense_id


def file_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def get_id_by_hash(conn: sqlite3.Connection, h: str) -> int | None:
    row = conn.execute("SELECT id FROM expenses WHERE file_hash=?", (h,)).fetchone()
    return row["id"] if row else None


def find_probable_duplicates(conn, vendor, expense_date, total_amount, exclude_id=None) -> list[int]:
    """Mismo proveedor, fecha e importe (ignora mayúsculas). Rechazados no cuentan."""
    if vendor is None or expense_date is None or total_amount is None:
        return []
    rows = conn.execute(
        """SELECT id FROM expenses
           WHERE vendor = ? COLLATE NOCASE AND expense_date = ?
             AND ABS(total_amount - ?) < 0.005 AND status != 'rejected'
             AND id IS NOT ?
           ORDER BY id""",
        (vendor, expense_date, total_amount, exclude_id),
    ).fetchall()
    return [r["id"] for r in rows]


def _in(value, allowed):
    return value if value in allowed else None


def insert_expense(conn, r: ExtractedReceipt, *, h: str, status: str,
                   review_reason: str | None, items_reconciled: bool,
                   image_path: str | None = None, raw_json: dict | None = None,
                   source: str = "cli") -> int:
    """Inserta cabecera y líneas en una transacción. Lanza DuplicateFileError si el hash existe."""
    existing = get_id_by_hash(conn, h)
    if existing is not None:
        raise DuplicateFileError(existing)
    with conn:
        cur = conn.execute(
            """INSERT INTO expenses (file_hash, vendor, vendor_normalized, expense_date,
                   date_ambiguous, purchase_time, base_amount, vat_amount, total_amount,
                   currency, category, payment_method, status, items_reconciled,
                   confidence, review_reason, image_path, raw_json, source)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (h, r.vendor, r.vendor, r.expense_date, int(r.date_ambiguous), r.purchase_time,
             r.base_amount, r.vat_amount, r.total_amount, r.currency,
             _in(r.category, config.TICKET_CATEGORIES), r.payment_method, status,
             int(items_reconciled), r.confidence, review_reason, image_path,
             json.dumps(raw_json, ensure_ascii=False) if raw_json is not None else None,
             source),
        )
        expense_id = cur.lastrowid
        conn.executemany(
            """INSERT INTO expense_items (expense_id, line_no, raw_description,
                   product_normalized, product_category, quantity, unit, unit_price,
                   discount, line_total)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            [(expense_id, n, it.raw_description, it.product_normalized,
              _in(it.product_category, config.PRODUCT_CATEGORIES), it.quantity, it.unit,
              it.unit_price, it.discount, it.line_total)
             for n, it in enumerate(r.items, start=1)],
        )
    return expense_id


if __name__ == "__main__":
    from gastos.config import load_settings

    s = load_settings()
    init_db(s.db_path).close()
    print(f"Base creada en {s.db_path}")
