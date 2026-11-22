# Gastos: bot personal de tickets

Registra gastos a partir de fotos de tickets (Telegram), con validación
determinista y SQLite como única fuente de verdad. Ver el documento de
diseño para el detalle completo.

## Preparar el entorno

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env && chmod 600 .env   # y rellenar
.venv/bin/python -m gastos.db            # crea la base (fase 0)
.venv/bin/pytest
```

## Uso (fase 1, sin Telegram)

```bash
# Procesar un ticket (necesita ANTHROPIC_API_KEY)
.venv/bin/python -m gastos.cli process ruta/ticket.jpg [--model claude-haiku-4-5]

# Generar tickets sintéticos con su JSON de referencia (inventados, solo para pruebas)
.venv/bin/python -m tests.synthetic

# Informe de acierto por campo, % de líneas cuadradas y coste, comparando modelos
.venv/bin/python -m gastos.evaluate tests/fixtures/tickets \
    --models claude-sonnet-5-5 claude-haiku-4-5
```

Los tickets sintéticos salen más limpios que una foto real: la medición con ellos es
optimista. Para fijar umbrales hay que repetirla con tickets reales.

## Estado
- Fase 0: estructura, configuración, esquema SQLite y `init_db`. ✅
- Fase 1: modelos, validadores, guardado y deduplicación ✅; extractor, pipeline, CLI e
  informe de acierto ✅ (pendiente de medir contra la API).
