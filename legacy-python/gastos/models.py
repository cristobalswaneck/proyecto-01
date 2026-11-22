"""Forma de los datos. Sin lógica de negocio: las reglas viven en validators.py."""
from typing import Literal

from pydantic import BaseModel, Field


class ExtractedItem(BaseModel):
    raw_description: str                      # tal cual, en el idioma del ticket
    product_normalized: str | None = None     # propuesto en español
    product_category: str | None = None
    quantity: float | None = None
    unit: Literal["ud", "kg", "l"] | None = None
    unit_price: float | None = None
    discount: float | None = None             # importe positivo descontado
    line_total: float | None = None


class ExtractedReceipt(BaseModel):
    vendor: str | None = None
    expense_date: str | None = None           # ISO yyyy-mm-dd
    date_ambiguous: bool = False
    purchase_time: str | None = None
    base_amount: float | None = None
    vat_amount: float | None = None
    total_amount: float | None = None
    currency: str | None = None
    category: str | None = None
    payment_method: Literal["card", "cash", "other"] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    items: list[ExtractedItem] = Field(default_factory=list)


class ValidationIssue(BaseModel):
    code: str
    severity: Literal["block", "review", "warn"]
    message: str
    line_no: int | None = None                # 1-based, si afecta a una línea


class PipelineResult(BaseModel):
    status: Literal["pending", "review", "rejected"]
    expense_id: int | None = None
    issues: list[ValidationIssue] = Field(default_factory=list)
    items_reconciled: bool = False
    items_diff: float | None = None           # total ticket - suma de líneas
    duplicate_of: int | None = None           # duplicado exacto (hash)
    probable_duplicates: list[int] = Field(default_factory=list)
