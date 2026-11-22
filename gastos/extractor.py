"""Imagen -> ExtractedReceipt con Claude. La IA solo lee; no calcula ni valida."""
import base64
import io

from PIL import Image, ImageOps
from pydantic import ValidationError

from gastos import config
from gastos.models import ExtractedReceipt

TOOL_NAME = "register_receipt"
MAX_SIDE = 1568  # px; más grande no aporta y encarece
DEFAULT_MODEL = "claude-sonnet-5-5"


class ExtractionError(Exception):
    """El modelo no devolvió un JSON válido tras el reintento."""


def _nullable(t, **extra):
    return {"type": [t, "null"], **extra}


def _schema() -> dict:
    item = {
        "type": "object",
        "additionalProperties": False,
        "required": ["raw_description", "product_normalized", "product_category", "quantity",
                     "unit", "unit_price", "discount", "line_total"],
        "properties": {
            "raw_description": {"type": "string"},
            "product_normalized": _nullable("string"),
            "product_category": {"enum": [*config.PRODUCT_CATEGORIES, None]},
            "quantity": _nullable("number"),
            "unit": {"enum": [*config.UNITS, None]},
            "unit_price": _nullable("number"),
            "discount": _nullable("number"),
            "line_total": _nullable("number"),
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["vendor", "expense_date", "date_ambiguous", "purchase_time", "base_amount",
                     "vat_amount", "total_amount", "currency", "category", "payment_method",
                     "confidence", "items"],
        "properties": {
            "vendor": _nullable("string"),
            "expense_date": _nullable("string"),
            "date_ambiguous": {"type": "boolean"},
            "purchase_time": _nullable("string"),
            "base_amount": _nullable("number"),
            "vat_amount": _nullable("number"),
            "total_amount": _nullable("number"),
            "currency": _nullable("string"),
            "category": {"enum": [*config.TICKET_CATEGORIES, None]},
            "payment_method": {"enum": [*config.PAYMENT_METHODS, None]},
            "confidence": {"type": "number"},
            "items": {"type": "array", "items": item},
        },
    }


TOOL = {
    "name": TOOL_NAME,
    "description": "Registra los datos leídos del ticket.",
    "strict": True,
    "input_schema": _schema(),
}

SYSTEM_PROMPT = f"""Eres un lector de tickets de compra. Lees la imagen y registras lo que ves \
llamando SIEMPRE a la herramienta `{TOOL_NAME}`. No calculas, no corriges y no validas cifras: \
transcribes lo que dice el ticket.

Reglas:
- Un campo que no aparece en el ticket es null. Nunca inventes datos.
- Fechas en formato ISO (aaaa-mm-dd). Si el formato es ambiguo (p. ej. 03/04/26 y no se puede \
deducir si es dd/mm o mm/dd por el país o el contexto), pon date_ambiguous=true en lugar de adivinar \
y deja expense_date en null.
- Interpreta bien los separadores decimales y de miles según el país del ticket.
- currency: código ISO 4217 de la moneda del ticket (EUR, USD, GBP...).
- category (ticket) solo de esta lista: {", ".join(config.TICKET_CATEGORIES)}.
- product_category solo de esta lista: {", ".join(config.PRODUCT_CATEGORIES)}.
- raw_description: el texto de la línea tal cual, en el idioma del ticket. product_normalized: \
nombre del producto expandido y en español, para poder comparar entre tickets.
- Productos al peso: quantity en kg y unit_price el precio por kg. unit es ud, kg o l.
- Descuentos: en el campo discount como importe positivo, nunca mezclados con unit_price.
- base_amount y vat_amount solo si el ticket los muestra; si hay varios tipos de IVA, usa los totales.
- payment_method: card, cash u other.
- confidence entre 0 y 1: tu confianza honesta en la lectura completa.
- NO transcribas datos personales: números de tarjeta, tarjetas de fidelización, nombres de personas \
ni direcciones."""


def prepare_image(data: bytes) -> tuple[bytes, str]:
    """Corrige la orientación EXIF, reduce el lado largo y devuelve (JPEG, media_type)."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88)
    return out.getvalue(), "image/jpeg"


def _call(client, model: str, image_b64: str, media_type: str):
    return client.messages.create(
        model=model,
        max_tokens=8000,
        system=SYSTEM_PROMPT,
        tools=[TOOL],
        # Sonnet 5.5 rechaza tool_choice forzado (400): se pide la herramienta en el prompt.
        tool_choice={"type": "auto"},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
            {"type": "text", "text": f"Registra este ticket con `{TOOL_NAME}`."},
        ]}],
    )


def extract(client, image_bytes: bytes, model: str = DEFAULT_MODEL) -> tuple[ExtractedReceipt, dict]:
    """Una llamada, con un reintento si el JSON no valida.

    Devuelve (recibo, meta); meta lleva el JSON crudo y el uso de tokens (suma de intentos).
    """
    data, media_type = prepare_image(image_bytes)
    b64 = base64.standard_b64encode(data).decode()
    usage = {"input_tokens": 0, "output_tokens": 0, "attempts": 0}
    last_error = "sin respuesta"
    for _ in range(2):
        resp = _call(client, model, b64, media_type)
        usage["attempts"] += 1
        usage["input_tokens"] += resp.usage.input_tokens
        usage["output_tokens"] += resp.usage.output_tokens
        if resp.stop_reason == "refusal":
            last_error = "el modelo rechazó la petición"
            continue
        block = next((b for b in resp.content
                      if b.type == "tool_use" and b.name == TOOL_NAME), None)
        if block is None:
            last_error = "el modelo no llamó a la herramienta"
            continue
        try:
            receipt = ExtractedReceipt.model_validate(block.input)
        except ValidationError as e:
            last_error = f"JSON no válido: {e.error_count()} errores"
            continue
        return receipt, {"model": model, "usage": usage, "extracted": block.input}
    raise ExtractionError(last_error)


def estimate_cost_usd(model: str, usage: dict) -> float | None:
    price = config.PRICING_PER_MTOK.get(model)
    if price is None:
        return None
    return (usage["input_tokens"] * price[0] + usage["output_tokens"] * price[1]) / 1_000_000
