from datetime import date

from gastos.models import ExtractedItem, ExtractedReceipt
from gastos.validators import decide_status, validate_header, validate_items

TODAY = date(2026, 10, 4)


def receipt(**kw):
    base = dict(vendor="Mercadona", expense_date="2026-10-01", total_amount=10.0,
                currency="EUR", category="Alimentación", confidence=0.95)
    return ExtractedReceipt(**{**base, **kw})


def codes(issues):
    return {i.code for i in issues}


def test_clean_receipt_has_no_issues():
    assert validate_header(receipt(base_amount=9.09, vat_amount=0.91), TODAY) == []


def test_base_vat_total():
    assert "base_vat_total" in codes(validate_header(receipt(base_amount=8, vat_amount=1), TODAY))
    # tolerancia 0,02
    assert "base_vat_total" not in codes(
        validate_header(receipt(base_amount=9.08, vat_amount=0.91), TODAY))
    # solo si ambos aparecen
    assert "base_vat_total" not in codes(validate_header(receipt(base_amount=5), TODAY))


def test_vat_greater_than_total():
    assert "vat_gt_total" in codes(validate_header(receipt(vat_amount=11), TODAY))


def test_dates():
    assert "date_future" in codes(validate_header(receipt(expense_date="2026-10-05"), TODAY))
    assert "date_future" not in codes(validate_header(receipt(expense_date="2026-10-04"), TODAY))
    assert "date_old" in codes(validate_header(receipt(expense_date="2025-08-01"), TODAY))
    assert "date_invalid" in codes(validate_header(receipt(expense_date="2026-13-40"), TODAY))
    assert "date_missing" in codes(validate_header(receipt(expense_date=None), TODAY))
    assert "date_ambiguous" in codes(validate_header(receipt(date_ambiguous=True), TODAY))


def test_category_amount_confidence():
    assert "category_invalid" in codes(validate_header(receipt(category="Comida"), TODAY))
    assert "category_invalid" in codes(validate_header(receipt(category=None), TODAY))
    assert "amount_high" in codes(validate_header(receipt(total_amount=10_000.01), TODAY))
    assert "amount_high" not in codes(validate_header(receipt(total_amount=10_000), TODAY))
    assert "low_confidence" in codes(validate_header(receipt(confidence=0.7), TODAY))
    assert "total_missing" in codes(validate_header(receipt(total_amount=None), TODAY))


def item(**kw):
    return ExtractedItem(raw_description="X", **kw)


def test_line_math_and_discount():
    ok = item(quantity=2, unit_price=1.5, discount=0.5, line_total=2.5)
    bad = item(quantity=2, unit_price=1.5, line_total=2.0)
    issues, _, _ = validate_items(receipt(total_amount=4.5, items=[ok, bad]))
    assert [i.line_no for i in issues if i.code == "line_mismatch"] == [2]


def test_weighed_product():
    it = item(quantity=0.532, unit="kg", unit_price=12.9, line_total=6.86)
    issues, rec, diff = validate_items(receipt(total_amount=6.86, items=[it]))
    assert rec and diff == 0 and not issues


def test_reconciled_and_not():
    items = [item(line_total=4.0), item(line_total=5.0)]
    _, rec, diff = validate_items(receipt(total_amount=9.04, items=items))
    assert rec  # dentro de 0,05
    issues, rec, diff = validate_items(receipt(total_amount=13.10, items=items))
    assert not rec and diff == 4.10
    assert "items_dont_add_up" in codes(issues)


def test_items_incomplete_and_empty():
    _, rec, diff = validate_items(receipt(items=[item(line_total=None)]))
    assert not rec and diff is None
    issues, rec, _ = validate_items(receipt(items=[]))
    assert not rec and "no_items" in codes(issues)


def test_unreconciled_lines_do_not_block():
    items = [item(line_total=1.0)]
    issues = validate_header(receipt(), TODAY) + validate_items(receipt(items=items))[0]
    assert decide_status(issues) == ("pending", None)


def test_status_decision():
    status, reason = decide_status(validate_header(receipt(date_ambiguous=True), TODAY))
    assert status == "review" and "ambigua" in reason
    assert decide_status(validate_header(receipt(category="x"), TODAY))[0] == "review"
    assert decide_status(validate_header(receipt(expense_date="2025-01-01"), TODAY))[0] == "pending"
