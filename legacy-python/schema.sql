-- Esquema SQLite. Fuente de verdad del sistema.
-- Los CHECK de categorías duplican las listas de gastos/config.py;
-- tests/test_db.py verifica que coinciden.

CREATE TABLE IF NOT EXISTS expenses (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    file_hash        TEXT NOT NULL UNIQUE,            -- SHA-256 de la imagen
    vendor           TEXT,
    vendor_normalized TEXT,
    expense_date     TEXT,                            -- ISO yyyy-mm-dd
    date_ambiguous   INTEGER NOT NULL DEFAULT 0 CHECK (date_ambiguous IN (0,1)),
    purchase_time    TEXT,
    base_amount      REAL,
    vat_amount       REAL,
    total_amount     REAL,
    currency         TEXT,                            -- moneda original (ISO 4217)
    category         TEXT CHECK (category IS NULL OR category IN (
        'Alimentación','Restauración','Transporte','Vivienda','Suministros',
        'Salud','Ocio','Compras','Tecnología','Suscripciones','Viajes',
        'Formación','Otros')),
    payment_method   TEXT CHECK (payment_method IS NULL
                                 OR payment_method IN ('card','cash','other')),
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','review','rejected')),
    items_reconciled INTEGER NOT NULL DEFAULT 0 CHECK (items_reconciled IN (0,1)),
    confidence       REAL,
    review_reason    TEXT,
    image_path       TEXT,
    raw_json         TEXT,                            -- respuesta del modelo + uso de tokens
    source           TEXT,                            -- p. ej. 'cli', 'telegram'
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    confirmed_at     TEXT,
    notion_page_id   TEXT,
    notion_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS expense_items (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_id         INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    line_no            INTEGER NOT NULL,
    raw_description    TEXT,                          -- tal cual, idioma del ticket
    product_normalized TEXT,                          -- siempre en español
    product_category   TEXT CHECK (product_category IS NULL OR product_category IN (
        'Frutas y verduras','Carne y pescado','Lácteos y huevos','Panadería',
        'Bebidas','Despensa','Congelados','Snacks y dulces','Limpieza',
        'Higiene','Hogar','Mascotas','Otros')),
    quantity           REAL,
    unit               TEXT CHECK (unit IS NULL OR unit IN ('ud','kg','l')),
    unit_price         REAL,
    discount           REAL,
    line_total         REAL,
    notion_page_id     TEXT,
    UNIQUE (expense_id, line_no)
);

CREATE TABLE IF NOT EXISTS vendor_aliases (
    alias          TEXT PRIMARY KEY,
    canonical_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_aliases (
    alias            TEXT PRIMARY KEY,
    canonical_name   TEXT NOT NULL,
    product_category TEXT
);

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_date_total
    ON expenses (vendor, expense_date, total_amount);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (status);
CREATE INDEX IF NOT EXISTS idx_expenses_date   ON expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_items_expense   ON expense_items (expense_id);
CREATE INDEX IF NOT EXISTS idx_items_product   ON expense_items (product_normalized);
