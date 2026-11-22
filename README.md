# Gastos: web app personal de tickets

Subes la foto (o captura) de un ticket, el sistema extrae cabecera y líneas, las valida con
reglas deterministas, te pide confirmación y lo guarda. Después puedes ver el gasto por mes y
categoría y **cómo evoluciona el precio de un mismo producto** (tu inflación personal).

## Principios
1. **La IA solo lee.** Extrae cabecera y líneas; el código hace sumas, fechas, duplicados, categorías y cuadre.
2. **SQLite es la única fuente de verdad.**
3. **Nada queda confirmado sin tu confirmación explícita.**
4. **Privacidad:** el esquema de extracción no incluye tarjetas, nombres ni direcciones; los logs no llevan importes.
5. **Simplicidad:** SQL explícito, sin ORM; interfaz sin proceso de compilación.

## Estructura
```
src/          servidor (Node 22 + TypeScript + Fastify + better-sqlite3)
  config.ts validators.ts models.ts db.ts schema.ts extractor.ts pipeline.ts insights.ts server.ts index.ts
public/       interfaz (HTML + JS sin dependencias; gráficos con Chart.js servido por el propio servidor)
test/         pruebas (vitest)
fixtures/     7 tickets sintéticos (imagen + JSON correcto) para pruebas y mediciones
legacy-python/  primer prototipo en Python; su lógica ya está portada y se eliminará en la fase W1
```

## Arrancar en local
```bash
npm install
cp .env.example .env      # opcional en desarrollo
npm run dev               # http://localhost:3000
npm test                  # pruebas
npm run typecheck && npm run build && npm start
```
Sin `APP_PASSWORD` entra sin contraseña (solo en desarrollo). Con `EXTRACTOR=stub` (por defecto) el
"lector" devuelve datos de demostración tomados de `fixtures/` **sin mirar la imagen**; la interfaz lo avisa.

## Qué hay y qué falta

| Fase | Entrega | Estado |
|---|---|---|
| W0 | Esqueleto: servidor, SQLite, validadores, pipeline, subida, listado, confirmación, análisis, acceso | ✅ |
| W1 | Lector real con Claude, medición de acierto/coste, retirar `legacy-python/` | ⏳ necesita `ANTHROPIC_API_KEY` |
| W2 | Editar ticket y líneas, cola de revisión pulida, HEIC | ⏳ |
| W3 | Alias y fusión de productos y comercios | ⏳ |
| W4 | Más análisis (frecuencia de compra, comparativa entre comercios, inflación de la cesta) | ⏳ |
| W5 | Despliegue en Railway con volumen y copia de seguridad | ⏳ |

Notas de producto:
- Los análisis usan solo tickets **confirmados y en EUR**; los precios, además, solo tickets con **líneas cuadradas**. La pantalla indica cuántos se excluyen.
- Los precios se comparan por unidad (kg, l, ud) sin mezclarlas.
- Para que la inflación diga algo hace falta que un mismo producto tenga el mismo nombre normalizado entre tickets (W3) y varios meses de datos.

## Despliegue en Railway (resumen; se completa en W5)
- Variables: `NODE_ENV=production`, `APP_PASSWORD`, `SESSION_SECRET`, `DATA_DIR=/data`, `ANTHROPIC_API_KEY`, `EXTRACTOR=claude`.
- **Volumen** montado en `/data`: el disco de Railway se borra en cada despliegue, y ahí viven la base y las imágenes.
- Una sola instancia (SQLite no admite varias escribiendo). Comprobación de salud: `/health`.
- Build: `npm run build`; arranque: `npm start`.
