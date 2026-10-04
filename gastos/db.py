"""SQLite con SQL explícito (sin ORM)."""
import sqlite3
from pathlib import Path

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


if __name__ == "__main__":
    from gastos.config import load_settings

    s = load_settings()
    init_db(s.db_path).close()
    print(f"Base creada en {s.db_path}")
