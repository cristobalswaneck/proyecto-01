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

## Estado
- Fase 0: estructura, configuración, esquema SQLite y `init_db`.
