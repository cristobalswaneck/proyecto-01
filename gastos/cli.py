"""Núcleo sin Telegram: procesa una imagen local.

    python -m gastos.cli process ruta/ticket.jpg [--model claude-sonnet-5-5]
"""
import argparse
import sys
from pathlib import Path

import anthropic

from gastos import db, extractor
from gastos.config import load_settings
from gastos.pipeline import process_image


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="gastos")
    sub = p.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("process", help="procesa una imagen de ticket")
    pr.add_argument("image", type=Path)
    pr.add_argument("--model", default=None)
    args = p.parse_args(argv)

    s = load_settings()
    if not s.anthropic_api_key:
        print("Falta ANTHROPIC_API_KEY en el entorno o en .env", file=sys.stderr)
        return 2
    data = args.image.read_bytes()
    if len(data) > s.max_image_bytes:
        print(f"La imagen supera el límite de {s.max_image_bytes} bytes", file=sys.stderr)
        return 2

    model = args.model or s.anthropic_model
    client = anthropic.Anthropic(api_key=s.anthropic_api_key)
    conn = db.init_db(s.db_path)
    result = process_image(
        conn, data, images_dir=s.images_dir,
        extract_fn=lambda b: extractor.extract(client, b, model))

    print(f"estado: {result.status}  id: {result.expense_id}  líneas cuadran: {result.items_reconciled}")
    for i in result.issues:
        print(f"  [{i.severity}] {i.message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
