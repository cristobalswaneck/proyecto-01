import json
from pathlib import Path

from gastos import evaluate
from gastos.models import ExtractedReceipt
from gastos.validators import validate_items

FIXTURES = Path(__file__).parent / "fixtures" / "tickets"


def refs():
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(FIXTURES.glob("*.json"))]


def test_every_reference_json_is_valid_and_its_lines_reconcile():
    data = refs()
    assert len(data) >= 6
    for d in data:
        r = ExtractedReceipt.model_validate(d)
        _, reconciled, diff = validate_items(r)
        assert reconciled, (r.vendor, diff)


def test_every_reference_has_an_image():
    for j in FIXTURES.glob("*.json"):
        assert any(j.with_suffix(e).exists() for e in evaluate.IMAGE_EXT), j.name


def test_perfect_extraction_scores_100():
    for d in refs():
        assert all(evaluate.compare(d, ExtractedReceipt.model_validate(d)).values())


def test_compare_detects_wrong_fields():
    d = refs()[0]
    bad = ExtractedReceipt.model_validate(d)
    bad.total_amount += 1
    bad.items[0].quantity = 99
    res = evaluate.compare(d, bad)
    assert not res["total_amount"] and not res["items.quantity"] and res["vendor"]


def test_missing_lines_fail_item_fields():
    d = refs()[0]
    got = ExtractedReceipt.model_validate(d)
    got.items.pop()
    res = evaluate.compare(d, got)
    assert not res["item_count"] and not res["items.line_total"]


def test_ambiguous_date_is_not_scored_on_the_date_itself():
    d = next(x for x in refs() if x["date_ambiguous"])
    got = ExtractedReceipt.model_validate({**d, "expense_date": "2026-03-04"})
    res = evaluate.compare(d, got)
    assert "expense_date" not in res and res["date_ambiguous"]


def test_summary_and_report():
    d = refs()[0]
    results = [{"name": "x", "expected": d, "ok": True, "extracted": d,
                "usage": {"input_tokens": 1000, "output_tokens": 500}},
               {"name": "y", "expected": d, "ok": False, "error": "e",
                "usage": {"input_tokens": 0, "output_tokens": 0}}]
    s = evaluate.summarize("claude-sonnet-5-5", results)
    assert s["extraction_failures"] == 1 and s["reconciled_pct"] == 0.5
    assert s["avg_cost_usd"] == (0.007 + 0) / 2
    assert "claude-sonnet-5-5" in evaluate.format_report([s])
