"""Informe de acierto sobre un conjunto de tickets con JSON de referencia.

    python -m gastos.evaluate tests/fixtures/tickets --models claude-sonnet-5-5 claude-haiku-4-5

Cada ticket x.png/x.jpg debe tener un x.json con el resultado correcto (formato ExtractedReceipt).
Los resultados del modelo se guardan en <carpeta>/_runs/<modelo>/ para auditar y no repetir llamadas.
"""
import argparse
import json
import sys
from pathlib import Path

from gastos import extractor, validators
from gastos.models import ExtractedReceipt

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
HEADER_FIELDS = ["vendor", "expense_date", "date_ambiguous", "purchase_time", "base_amount",
                 "vat_amount", "total_amount", "currency", "category", "payment_method"]
ITEM_FIELDS = ["quantity", "unit", "unit_price", "discount", "line_total"]


def _norm(v):
    return v.strip().casefold() if isinstance(v, str) else v


def _eq(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) < 0.005
    if a in (None, 0) and b in (None, 0):  # descuento ausente == 0
        return True
    return _norm(a) == _norm(b)


def compare(expected: dict, got: ExtractedReceipt) -> dict[str, bool]:
    """Campo -> acierto. Si la fecha de referencia es null (ambigua) no se puntúa la fecha."""
    g = got.model_dump()
    out = {}
    for f in HEADER_FIELDS:
        if f == "expense_date" and expected.get("date_ambiguous"):
            continue
        out[f] = _eq(expected.get(f), g.get(f))
    exp_items = expected.get("items", [])
    out["item_count"] = len(exp_items) == len(got.items)
    # Líneas: se comparan por posición; sin el mismo número de líneas, cuentan como fallo.
    for f in ITEM_FIELDS:
        ok = out["item_count"] and all(_eq(e.get(f), i.model_dump().get(f))
                                       for e, i in zip(exp_items, got.items))
        out[f"items.{f}"] = ok
    return out


def tickets(folder: Path):
    for img in sorted(folder.iterdir()):
        ref = img.with_suffix(".json")
        if img.suffix.lower() in IMAGE_EXT and ref.exists():
            yield img, json.loads(ref.read_text(encoding="utf-8"))


def run_model(client, folder: Path, model: str) -> list[dict]:
    runs = folder / "_runs" / model
    runs.mkdir(parents=True, exist_ok=True)
    results = []
    for img, expected in tickets(folder):
        cache = runs / f"{img.stem}.json"
        if cache.exists():
            rec = json.loads(cache.read_text(encoding="utf-8"))
        else:
            try:
                receipt, meta = extractor.extract(client, img.read_bytes(), model)
                rec = {"ok": True, "extracted": receipt.model_dump(), "usage": meta["usage"]}
            except extractor.ExtractionError as e:
                rec = {"ok": False, "error": str(e), "usage": {"input_tokens": 0, "output_tokens": 0}}
            cache.write_text(json.dumps(rec, ensure_ascii=False, indent=2), encoding="utf-8")
        results.append({"name": img.stem, "expected": expected, **rec})
    return results


def summarize(model: str, results: list[dict]) -> dict:
    n = len(results)
    field_hits: dict[str, list[bool]] = {}
    reconciled = 0
    costs = []
    failures = 0
    for r in results:
        c = extractor.estimate_cost_usd(model, r["usage"])
        if c is not None:
            costs.append(c)
        if not r["ok"]:
            failures += 1
            continue
        got = ExtractedReceipt.model_validate(r["extracted"])
        for f, ok in compare(r["expected"], got).items():
            field_hits.setdefault(f, []).append(ok)
        _, rec, _ = validators.validate_items(got)
        reconciled += rec
    return {"model": model, "tickets": n, "extraction_failures": failures,
            "field_accuracy": {f: sum(v) / len(v) for f, v in field_hits.items()},
            "reconciled_pct": reconciled / n if n else 0,
            "avg_cost_usd": sum(costs) / len(costs) if costs else None}


def format_report(summaries: list[dict]) -> str:
    lines = []
    for s in summaries:
        lines.append(f"\n=== {s['model']} ({s['tickets']} tickets, {s['extraction_failures']} fallos de extracción)")
        for f, acc in s["field_accuracy"].items():
            lines.append(f"  {f:<22}{acc:6.0%}")
        lines.append(f"  líneas cuadradas      {s['reconciled_pct']:6.0%}")
        cost = s["avg_cost_usd"]
        lines.append("  coste medio/ticket    " + (f"{cost:.4f} USD" if cost is not None else "n/d"))
    return "\n".join(lines)


def main(argv=None) -> int:
    import anthropic
    from gastos.config import load_settings

    p = argparse.ArgumentParser()
    p.add_argument("folder", type=Path)
    p.add_argument("--models", nargs="+", default=[extractor.DEFAULT_MODEL])
    args = p.parse_args(argv)
    s = load_settings()
    if not s.anthropic_api_key:
        print("Falta ANTHROPIC_API_KEY en el entorno o en .env", file=sys.stderr)
        return 2
    client = anthropic.Anthropic(api_key=s.anthropic_api_key)
    summaries = [summarize(m, run_model(client, args.folder, m)) for m in args.models]
    print(format_report(summaries))
    return 0


if __name__ == "__main__":
    sys.exit(main())
