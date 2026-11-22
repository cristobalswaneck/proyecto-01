// Esquema SQLite: única fuente de verdad. Los CHECK de categorías se generan desde config.ts.
import { PAYMENT_METHODS, PRODUCT_CATEGORIES, STATUSES, TICKET_CATEGORIES, UNITS } from "./config.js";

const list = (xs: readonly string[]) => xs.map((x) => `'${x.replaceAll("'", "''")}'`).join(",");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS expenses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_hash         TEXT NOT NULL UNIQUE,
  vendor            TEXT,
  vendor_normalized TEXT,
  expense_date      TEXT,
  date_ambiguous    INTEGER NOT NULL DEFAULT 0 CHECK (date_ambiguous IN (0,1)),
  purchase_time     TEXT,
  base_amount       REAL,
  vat_amount        REAL,
  total_amount      REAL,
  currency          TEXT,
  category          TEXT CHECK (category IS NULL OR category IN (${list(TICKET_CATEGORIES)})),
  payment_method    TEXT CHECK (payment_method IS NULL OR payment_method IN (${list(PAYMENT_METHODS)})),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (${list(STATUSES)})),
  items_reconciled  INTEGER NOT NULL DEFAULT 0 CHECK (items_reconciled IN (0,1)),
  confidence        REAL,
  review_reason     TEXT,
  image_path        TEXT,
  raw_json          TEXT,
  source            TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  confirmed_at      TEXT
);

CREATE TABLE IF NOT EXISTS expense_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id         INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  line_no            INTEGER NOT NULL,
  raw_description    TEXT,
  product_normalized TEXT,
  product_category   TEXT CHECK (product_category IS NULL OR product_category IN (${list(PRODUCT_CATEGORIES)})),
  quantity           REAL,
  unit               TEXT CHECK (unit IS NULL OR unit IN (${list(UNITS)})),
  unit_price         REAL,
  discount           REAL,
  line_total         REAL,
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

CREATE INDEX IF NOT EXISTS idx_expenses_vendor_date_total ON expenses (vendor, expense_date, total_amount);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses (status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_items_expense ON expense_items (expense_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON expense_items (product_normalized);
`;
