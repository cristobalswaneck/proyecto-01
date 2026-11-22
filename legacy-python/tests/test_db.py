import re
import sqlite3

import pytest

from gastos import config
from gastos.db import SCHEMA_PATH, init_db


@pytest.fixture
def conn(tmp_path):
    c = init_db(tmp_path / "t.db")
    yield c
    c.close()


def names(conn, kind):
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type=?", (kind,))
    return {r[0] for r in rows}


def test_creates_tables_and_indexes(conn):
    assert {"expenses", "expense_items", "vendor_aliases", "product_aliases"} <= names(conn, "table")
    assert {"idx_expenses_vendor_date_total", "idx_expenses_status", "idx_expenses_date",
            "idx_items_expense", "idx_items_product"} <= names(conn, "index")


def test_idempotent(tmp_path):
    init_db(tmp_path / "t.db").close()
    init_db(tmp_path / "t.db").close()


def test_wal_and_foreign_keys(conn):
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def raw_insert(conn, h="abc", **kw):
    cols = {"file_hash": h, **kw}
    conn.execute(
        f"INSERT INTO expenses ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        tuple(cols.values()),
    )


def test_file_hash_unique(conn):
    raw_insert(conn)
    with pytest.raises(sqlite3.IntegrityError):
        raw_insert(conn)


def test_closed_lists_enforced(conn):
    with pytest.raises(sqlite3.IntegrityError):
        raw_insert(conn, category="Inventada")
    with pytest.raises(sqlite3.IntegrityError):
        raw_insert(conn, h="x", status="done")


def test_items_foreign_key_and_cascade(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO expense_items (expense_id, line_no) VALUES (99, 1)")
    raw_insert(conn)
    conn.execute("INSERT INTO expense_items (expense_id, line_no) VALUES (1, 1)")
    conn.execute("DELETE FROM expenses WHERE id=1")
    assert conn.execute("SELECT COUNT(*) FROM expense_items").fetchone()[0] == 0


def test_schema_check_lists_match_config():
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    found = [set(re.findall(r"'([^']+)'", m)) for m in
             re.findall(r"category[^\n]*IN \((.*?)\)\)", sql, re.S)]
    assert config.TICKET_CATEGORIES and set(config.TICKET_CATEGORIES) in found
    assert set(config.PRODUCT_CATEGORIES) in found


# --- guardado y deduplicación ---
from gastos.db import (DuplicateFileError, file_hash, find_probable_duplicates,
                       get_id_by_hash, insert_expense)
from gastos.models import ExtractedItem, ExtractedReceipt


def sample(**kw):
    base = dict(vendor="Mercadona", expense_date="2026-10-01", total_amount=9.0,
                currency="EUR", category="Alimentación", confidence=0.9,
                items=[ExtractedItem(raw_description="LECHE ENT", product_normalized="Leche entera",
                                     product_category="Lácteos y huevos", quantity=1, unit="ud",
                                     unit_price=4.0, line_total=4.0),
                       ExtractedItem(raw_description="PAN", product_category="Inventada",
                                     quantity=1, unit_price=5.0, line_total=5.0)])
    return ExtractedReceipt(**{**base, **kw})


def save(conn, h="h1", **kw):
    return insert_expense(conn, sample(**kw), h=h, status="pending", review_reason=None,
                          items_reconciled=True, raw_json={"usage": {"input_tokens": 1}})


def test_insert_saves_header_and_items(conn):
    eid = save(conn)
    row = conn.execute("SELECT * FROM expenses WHERE id=?", (eid,)).fetchone()
    assert row["vendor"] == "Mercadona" and row["items_reconciled"] == 1
    assert '"input_tokens"' in row["raw_json"]
    items = conn.execute("SELECT * FROM expense_items WHERE expense_id=? ORDER BY line_no", (eid,)).fetchall()
    assert [i["line_no"] for i in items] == [1, 2]
    assert items[1]["product_category"] is None  # categoría inválida no se guarda


def test_same_file_is_rejected_and_nothing_is_inserted(conn):
    first = save(conn)
    with pytest.raises(DuplicateFileError) as e:
        save(conn)
    assert e.value.expense_id == first
    assert conn.execute("SELECT COUNT(*) FROM expenses").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM expense_items").fetchone()[0] == 2


def test_hash_helpers(conn):
    h = file_hash(b"abc")
    assert len(h) == 64 and h == file_hash(b"abc") and h != file_hash(b"abd")
    eid = save(conn, h=h)
    assert get_id_by_hash(conn, h) == eid and get_id_by_hash(conn, "nope") is None


def test_probable_duplicates(conn):
    eid = save(conn, h="a")
    assert find_probable_duplicates(conn, "mercadona", "2026-10-01", 9.0) == [eid]
    assert find_probable_duplicates(conn, "Mercadona", "2026-10-02", 9.0) == []
    assert find_probable_duplicates(conn, "Mercadona", "2026-10-01", 9.5) == []
    assert find_probable_duplicates(conn, "Mercadona", "2026-10-01", 9.0, exclude_id=eid) == []
    assert find_probable_duplicates(conn, None, "2026-10-01", 9.0) == []
    conn.execute("UPDATE expenses SET status='rejected'")
    assert find_probable_duplicates(conn, "Mercadona", "2026-10-01", 9.0) == []


def test_failed_item_insert_rolls_back_header(conn):
    bad = sample()
    bad.items[1].quantity = object()  # SQLite no puede guardarlo: falla al insertar líneas
    with pytest.raises(Exception):
        insert_expense(conn, bad, h="z", status="pending", review_reason=None, items_reconciled=False)
    assert conn.execute("SELECT COUNT(*) FROM expenses").fetchone()[0] == 0
