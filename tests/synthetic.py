"""Genera tickets de prueba (PNG/JPG) con su JSON de referencia.

    python -m tests.synthetic

Son inventados: nombres, direcciones y tarjetas no existen. Salen limpios; los marcados
`messy` se giran y comprimen para parecerse algo más a una foto real. Aun así NO
sustituyen a tickets reales: la medición con ellos es optimista.
"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).parent / "fixtures" / "tickets"


def line(desc, qty, price, discount=None, unit="ud", cat="Despensa", norm=None):
    total = round(qty * price - (discount or 0), 2)
    return dict(raw_description=desc, product_normalized=norm or desc.title(), product_category=cat,
                quantity=qty, unit=unit, unit_price=price, discount=discount, line_total=total)


def spec(name, labels, vendor, date_txt, date_iso, currency, category, pay, items, *, fmt,
         vat_rate=None, time="12:00", ambiguous=False, messy=False, extra=(), conf=0.9):
    total = round(sum(i["line_total"] for i in items), 2)
    base = vat = None
    if vat_rate:
        base = round(total / (1 + vat_rate), 2)
        vat = round(total - base, 2)
    expected = dict(vendor=vendor, expense_date=None if ambiguous else date_iso,
                    date_ambiguous=ambiguous, purchase_time=time, base_amount=base, vat_amount=vat,
                    total_amount=total, currency=currency, category=category, payment_method=pay,
                    confidence=conf, items=items)
    return dict(name=name, labels=labels, vendor=vendor, date_txt=date_txt, fmt=fmt, messy=messy,
                extra=list(extra), expected=expected)


def money(v, fmt):
    s = f"{v:,.2f}"
    if fmt["dec"] == ",":
        s = s.replace(",", "§").replace(".", ",").replace("§", ".")
    return f"{fmt['pre']}{s}{fmt['post']}"


EUR = dict(dec=",", pre="", post=" EUR")
GBP = dict(dec=".", pre="£", post="")
USD = dict(dec=".", pre="$", post="")

SPECS = [
    spec("es_supermercado", dict(total="TOTAL (EUR)", vat="IVA", base="BASE", pay="TARJETA BANCARIA"),
         "Supermercado Ficticio", "14/09/2026 18:42", "2026-09-14", "EUR", "Alimentación", "card",
         [line("LECHE ENT 1L", 2, 0.89, norm="Leche entera", cat="Lácteos y huevos"),
          line("MANZANA GOLDEN", 0.732, 2.49, unit="kg", norm="Manzana golden", cat="Frutas y verduras"),
          line("PAN BARRA", 1, 0.65, norm="Pan de barra", cat="Panadería"),
          line("DET. ROPA 3L", 1, 7.95, discount=1.00, norm="Detergente ropa", cat="Limpieza"),
          line("YOGUR NAT X4", 2, 1.35, norm="Yogur natural", cat="Lácteos y huevos"),
          line("AGUA 6X1.5L", 1, 2.10, norm="Agua mineral", cat="Bebidas")],
         fmt=EUR, vat_rate=0.10, time="18:42"),
    spec("ca_fleca", dict(total="TOTAL", vat="IVA", base="BASE IMPOSABLE", pay="EFECTIU"),
         "Fleca Ficticia", "03/10/2026", "2026-10-03", "EUR", "Alimentación", "cash",
         [line("BARRA RUSTICA", 2, 1.40, norm="Pan rústico", cat="Panadería"),
          line("CROISSANT", 3, 1.20, norm="Cruasán", cat="Panadería"),
          line("ENSAIMADA", 1, 2.50, norm="Ensaimada", cat="Snacks y dulces")],
         fmt=EUR, vat_rate=0.10, time="09:15", extra=["TIQUET DE COMPRA", "GRÀCIES PER LA SEVA VISITA"]),
    spec("en_pub_gbp", dict(total="TOTAL", vat="VAT", base="NET", pay="CARD"),
         "The Imaginary Lion Pub", "25/09/2026 20:10", "2026-09-25", "GBP", "Restauración", "card",
         [line("FISH & CHIPS", 2, 14.50, norm="Fish and chips", cat="Otros"),
          line("PINT LAGER", 3, 5.80, norm="Pinta de cerveza", cat="Bebidas"),
          line("STICKY TOFFEE PUD", 1, 7.20, norm="Pudin de toffee", cat="Snacks y dulces")],
         fmt=GBP, vat_rate=0.20, time="20:10"),
    spec("us_ambiguous_date", dict(total="TOTAL", vat="TAX", base="SUBTOTAL", pay="CARD"),
         "Corner Market Demo", "03/04/26", "2026-04-03", "USD", "Alimentación", "card",
         [line("BANANAS", 1.2, 0.59, unit="kg", norm="Plátano", cat="Frutas y verduras"),
          line("COFFEE BEANS", 1, 11.99, norm="Café en grano", cat="Despensa")],
         fmt=USD, ambiguous=True, time="08:05"),
    spec("de_pfand", dict(total="SUMME", vat="MwSt", base="Netto", pay="EC-KARTE"),
         "Beispiel Markt GmbH", "21.09.2026 16:30", "2026-09-21", "EUR", "Alimentación", "card",
         [line("VOLLMILCH 1L", 3, 1.19, norm="Leche entera", cat="Lácteos y huevos"),
          line("BROT", 1, 2.99, norm="Pan", cat="Panadería"),
          line("PFAND", 3, 0.25, norm="Depósito de envase", cat="Otros"),
          line("TOMATEN", 0.418, 3.99, unit="kg", norm="Tomate", cat="Frutas y verduras")],
         fmt=EUR, vat_rate=0.07, time="16:30"),
    spec("es_gasolinera", dict(total="TOTAL", vat="IVA 21%", base="BASE", pay="TARJETA"),
         "Estación de Servicio Demo", "30/09/2026 07:55", "2026-09-30", "EUR", "Transporte", "card",
         [line("GASOLINA 95", 40.55, 1.459, unit="l", norm="Gasolina 95", cat="Otros")],
         fmt=EUR, vat_rate=0.21, time="07:55"),
    spec("ca_super_messy", dict(total="TOTAL A PAGAR", vat="IVA", base="BASE", pay="TARGETA"),
         "Supermercat Imaginari", "08/10/2026 19:20", "2026-10-08", "EUR", "Alimentación", "card",
         [line("LLET SEMI 1L", 6, 0.92, norm="Leche semidesnatada", cat="Lácteos y huevos"),
          line("OUS L X12", 1, 3.15, norm="Huevos", cat="Lácteos y huevos"),
          line("POLLASTRE", 1.104, 6.90, unit="kg", norm="Pollo", cat="Carne y pescado"),
          line("PASTA 500G", 2, 1.05, norm="Pasta", cat="Despensa"),
          line("PAPER HIG 12U", 1, 4.80, discount=0.80, norm="Papel higiénico", cat="Higiene"),
          line("CERVESA 33CL X6", 1, 4.50, norm="Cerveza", cat="Bebidas"),
          line("GALETES", 2, 1.65, norm="Galletas", cat="Snacks y dulces"),
          line("SABO MANS", 1, 2.20, norm="Jabón de manos", cat="Higiene")],
         fmt=EUR, vat_rate=0.10, time="19:20", messy=True, conf=0.8),
]


def render(s: dict) -> Image.Image:
    font = ImageFont.load_default(size=17)
    big = ImageFont.load_default(size=22)
    e, fmt = s["expected"], s["fmt"]
    W, pad = 520, 24
    rows = [(s["vendor"].upper(), big, "c"), ("", font, "l")]
    rows += [(t, font, "c") for t in s["extra"]]
    rows += [(s["date_txt"], font, "l"), ("-" * 44, font, "l")]
    body = []
    for it in e["items"]:
        qty = f"{it['quantity']:g}" if it["unit"] == "ud" else f"{it['quantity']:.3f} {it['unit']}"
        if fmt["dec"] == ",":
            qty = qty.replace(".", ",")
        body.append((it["raw_description"], f"{qty} x {money(it['unit_price'], fmt)}", it["line_total"],
                     it["discount"]))
    H = pad * 2 + 30 * (len(rows) + 3 * len(body) + 10)
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    y = pad
    for text, f, al in rows:
        x = (W - d.textlength(text, font=f)) / 2 if al == "c" else pad
        d.text((x, y), text, fill="black", font=f)
        y += 30
    for desc, qp, total, disc in body:
        d.text((pad, y), desc, fill="black", font=font)
        t = money(total, fmt)
        d.text((W - pad - d.textlength(t, font=font), y), t, fill="black", font=font)
        d.text((pad + 20, y + 22), qp, fill="#333", font=font)
        y += 48
        if disc:
            t = "-" + money(disc, fmt)
            d.text((pad + 20, y - 4), "DTO." if fmt["dec"] == "," else "DISC.", fill="black", font=font)
            d.text((W - pad - d.textlength(t, font=font), y - 4), t, fill="black", font=font)
            y += 26
    d.text((pad, y), "-" * 44, fill="black", font=font)
    y += 30
    L = s["labels"]
    if e["base_amount"] is not None:
        for lab, v in ((L["base"], e["base_amount"]), (L["vat"], e["vat_amount"])):
            t = money(v, fmt)
            d.text((pad, y), lab, fill="black", font=font)
            d.text((W - pad - d.textlength(t, font=font), y), t, fill="black", font=font)
            y += 28
    t = money(e["total_amount"], fmt)
    d.text((pad, y), L["total"], fill="black", font=big)
    d.text((W - pad - d.textlength(t, font=big), y), t, fill="black", font=big)
    y += 40
    d.text((pad, y), L["pay"], fill="black", font=font)
    img = img.crop((0, 0, W, y + pad + 20))
    if s["messy"]:
        rnd = random.Random(7)
        bg = Image.new("RGB", (W + 160, img.height + 160), (150, 140, 130))
        bg.paste(img, (80, 80))
        img = bg.rotate(1.8, resample=Image.BICUBIC, fillcolor=(150, 140, 130))
        img = img.filter(ImageFilter.GaussianBlur(0.9))
        px = img.load()
        for _ in range(img.width * img.height // 30):
            x, yy = rnd.randrange(img.width), rnd.randrange(img.height)
            v = rnd.randint(-25, 25)
            r, g, b = px[x, yy]
            px[x, yy] = (max(0, min(255, r + v)),) * 1 + (max(0, min(255, g + v)), max(0, min(255, b + v)))
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for s in SPECS:
        img = render(s)
        if s["messy"]:
            img.save(OUT / f"{s['name']}.jpg", quality=55)
        else:
            img.save(OUT / f"{s['name']}.png")
        (OUT / f"{s['name']}.json").write_text(
            json.dumps(s["expected"], ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(SPECS)} tickets en {OUT}")


if __name__ == "__main__":
    main()
