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


def insert_expense(conn, h="abc", **kw):
    cols = {"file_hash": h, **kw}
    conn.execute(
        f"INSERT INTO expenses ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
        tuple(cols.values()),
    )


def test_file_hash_unique(conn):
    insert_expense(conn)
    with pytest.raises(sqlite3.IntegrityError):
        insert_expense(conn)


def test_closed_lists_enforced(conn):
    with pytest.raises(sqlite3.IntegrityError):
        insert_expense(conn, category="Inventada")
    with pytest.raises(sqlite3.IntegrityError):
        insert_expense(conn, h="x", status="done")


def test_items_foreign_key_and_cascade(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO expense_items (expense_id, line_no) VALUES (99, 1)")
    insert_expense(conn)
    conn.execute("INSERT INTO expense_items (expense_id, line_no) VALUES (1, 1)")
    conn.execute("DELETE FROM expenses WHERE id=1")
    assert conn.execute("SELECT COUNT(*) FROM expense_items").fetchone()[0] == 0


def test_schema_check_lists_match_config():
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    found = [set(re.findall(r"'([^']+)'", m)) for m in
             re.findall(r"category[^\n]*IN \((.*?)\)\)", sql, re.S)]
    assert config.TICKET_CATEGORIES and set(config.TICKET_CATEGORIES) in found
    assert set(config.PRODUCT_CATEGORIES) in found
