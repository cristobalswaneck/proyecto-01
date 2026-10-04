"""Configuración (.env) y listas cerradas de categorías."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

TICKET_CATEGORIES = (
    "Alimentación", "Restauración", "Transporte", "Vivienda", "Suministros",
    "Salud", "Ocio", "Compras", "Tecnología", "Suscripciones", "Viajes",
    "Formación", "Otros",
)

PRODUCT_CATEGORIES = (
    "Frutas y verduras", "Carne y pescado", "Lácteos y huevos", "Panadería",
    "Bebidas", "Despensa", "Congelados", "Snacks y dulces", "Limpieza",
    "Higiene", "Hogar", "Mascotas", "Otros",
)

STATUSES = ("pending", "confirmed", "review", "rejected")
UNITS = ("ud", "kg", "l")
PAYMENT_METHODS = ("card", "cash", "other")


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str
    anthropic_model: str
    telegram_bot_token: str
    telegram_allowed_user_ids: frozenset[int]
    notion_token: str
    notion_parent_page_id: str
    db_path: Path
    images_dir: Path
    max_image_bytes: int


def load_settings() -> Settings:
    load_dotenv()
    allowed = os.getenv("TELEGRAM_ALLOWED_USER_IDS", "")
    return Settings(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        anthropic_model=os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
        telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
        telegram_allowed_user_ids=frozenset(
            int(x) for x in allowed.split(",") if x.strip()
        ),
        notion_token=os.getenv("NOTION_TOKEN", ""),
        notion_parent_page_id=os.getenv("NOTION_PARENT_PAGE_ID", ""),
        db_path=Path(os.getenv("DB_PATH", "data/gastos.db")),
        images_dir=Path(os.getenv("IMAGES_DIR", "data/images")),
        max_image_bytes=int(os.getenv("MAX_IMAGE_BYTES", "10000000")),
    )
