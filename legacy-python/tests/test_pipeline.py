from datetime import date
from types import SimpleNamespace

import pytest

from gastos import extractor
from gastos.db import init_db
from gastos.extractor import ExtractionError
from gastos.models import ExtractedItem, ExtractedReceipt
from gastos.pipeline import process_image

TODAY = date(2026, 10, 4)


@pytest.fixture
def conn(tmp_path):
    c = init_db(tmp_path / "t.db")
    yield c
    c.close()


def good(**kw):
    base = dict(vendor="Mercadona", expense_date="2026-10-01", total_amount=9.0, currency="EUR",
                category="Alimentación", confidence=0.9,
                items=[ExtractedItem(raw_description="A", quantity=1, unit_price=4.0, line_total=4.0),
                       ExtractedItem(raw_description="B", quantity=1, unit_price=5.0, line_total=5.0)])
    return ExtractedReceipt(**{**base, **kw})


def run(conn, tmp_path, data, receipt=None, error=None):
    def fn(_):
        if error:
            raise error
        return receipt, {"usage": {"input_tokens": 1, "output_tokens": 1}}
    return process_image(conn, data, extract_fn=fn, images_dir=tmp_path / "img", today=TODAY)


def test_clean_ticket_is_pending_and_reconciled(conn, tmp_path):
    r = run(conn, tmp_path, b"img1", good())
    assert r.status == "pending" and r.items_reconciled and r.expense_id
    row = conn.execute("SELECT image_path FROM expenses").fetchone()
    assert "/2026/10/" in row["image_path"]
    assert (row["image_path"] and oct(__import__("os").stat(row["image_path"]).st_mode)[-3:] == "600")


def test_same_image_twice_is_rejected_without_calling_the_model(conn, tmp_path):
    run(conn, tmp_path, b"img1", good())
    def boom(_):
        raise AssertionError("no debe llamar al modelo")
    r = process_image(conn, b"img1", extract_fn=boom, images_dir=tmp_path / "img", today=TODAY)
    assert r.status == "rejected" and r.duplicate_of
    assert conn.execute("SELECT COUNT(*) FROM expenses").fetchone()[0] == 1


def test_probable_duplicate_is_flagged_not_blocked(conn, tmp_path):
    first = run(conn, tmp_path, b"img1", good())
    r = run(conn, tmp_path, b"img2", good())
    assert r.status == "pending" and r.probable_duplicates == [first.expense_id]
    assert "probable_duplicate" in {i.code for i in r.issues}


def test_unreconciled_lines_do_not_block(conn, tmp_path):
    r = run(conn, tmp_path, b"img3", good(total_amount=13.1))
    assert r.status == "pending" and not r.items_reconciled and r.items_diff == 4.10


def test_ambiguous_date_goes_to_review(conn, tmp_path):
    r = run(conn, tmp_path, b"img4", good(date_ambiguous=True, expense_date=None))
    assert r.status == "review"


def test_extraction_failure_goes_to_review_and_is_stored(conn, tmp_path):
    r = run(conn, tmp_path, b"img5", error=ExtractionError("JSON no válido"))
    assert r.status == "review" and r.expense_id
    row = conn.execute("SELECT status, review_reason FROM expenses").fetchone()
    assert row["status"] == "review" and "No se pudo leer" in row["review_reason"]


# --- extractor con un cliente simulado ---
def png_bytes():
    import io
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (3000, 2000), "white").save(b, "PNG")
    return b.getvalue()


def fake_client(responses):
    calls = []
    def create(**kw):
        calls.append(kw)
        return responses[len(calls) - 1]
    return SimpleNamespace(messages=SimpleNamespace(create=create)), calls


def reply(payload, stop="tool_use", name=extractor.TOOL_NAME):
    content = [SimpleNamespace(type="tool_use", name=name, input=payload)] if payload is not None else []
    return SimpleNamespace(content=content, stop_reason=stop,
                           usage=SimpleNamespace(input_tokens=1000, output_tokens=200))


PAYLOAD = {"vendor": "X", "expense_date": "2026-10-01", "date_ambiguous": False, "total_amount": 5.0,
           "currency": "EUR", "category": "Otros", "confidence": 0.9, "items": []}


def test_image_is_resized_before_sending():
    data, media = extractor.prepare_image(png_bytes())
    from PIL import Image
    import io
    assert media == "image/jpeg" and max(Image.open(io.BytesIO(data)).size) <= extractor.MAX_SIDE


def test_extract_ok_sums_usage_and_does_not_force_tool_choice():
    client, calls = fake_client([reply(PAYLOAD)])
    receipt, meta = extractor.extract(client, png_bytes(), "claude-sonnet-5-5")
    assert receipt.vendor == "X" and meta["usage"]["attempts"] == 1
    assert calls[0]["tool_choice"] == {"type": "auto"} and calls[0]["tools"][0]["strict"] is True
    assert extractor.estimate_cost_usd("claude-sonnet-5-5", meta["usage"]) == pytest.approx(0.004)


def test_extract_retries_once_then_succeeds():
    client, calls = fake_client([reply({"confidence": 5}), reply(PAYLOAD)])
    receipt, meta = extractor.extract(client, png_bytes())
    assert len(calls) == 2 and meta["usage"]["input_tokens"] == 2000


def test_extract_fails_after_second_invalid_answer():
    client, calls = fake_client([reply(None, stop="end_turn"), reply({"confidence": 5})])
    with pytest.raises(ExtractionError):
        extractor.extract(client, png_bytes())
    assert len(calls) == 2


def test_refusal_is_handled():
    client, _ = fake_client([reply(None, stop="refusal"), reply(None, stop="refusal")])
    with pytest.raises(ExtractionError):
        extractor.extract(client, png_bytes())
