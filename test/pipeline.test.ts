import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractionError, ExtractorUnavailableError } from "../src/extractor.js";
import { processImage } from "../src/pipeline.js";
import { fakeExtractor, goodReceipt, memDb, png, tmpDir } from "./helpers.js";

const run = (db: ReturnType<typeof memDb>, data: Buffer, ex: ReturnType<typeof fakeExtractor>, imagesDir = tmpDir()) =>
  processImage(db, data, { extractor: ex, imagesDir, mime: "image/png", today: "2026-10-04" });

describe("pipeline", () => {
  it("un ticket limpio queda pendiente, cuadrado, y se guarda el original con permisos 600", async () => {
    const db = memDb();
    const dir = tmpDir();
    const r = await run(db, png("1"), fakeExtractor(goodReceipt()), dir);
    expect(r).toMatchObject({ status: "pending", itemsReconciled: true });
    const { image_path } = db.prepare("SELECT image_path FROM expenses").get() as { image_path: string };
    expect(image_path).toContain("/2026/10/");
    expect(fs.statSync(image_path).mode & 0o777).toBe(0o600);
  });
  it("la misma imagen dos veces se rechaza sin llamar al modelo", async () => {
    const db = memDb();
    await run(db, png("1"), fakeExtractor(goodReceipt()));
    const boom = { extract: async () => { throw new Error("no debe llamarse"); } };
    const r = await run(db, png("1"), boom as never);
    expect(r.status).toBe("rejected");
    expect(r.duplicateOf).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM expenses").get() as { n: number }).n).toBe(1);
  });
  it("un duplicado probable se avisa pero no se bloquea", async () => {
    const db = memDb();
    const first = await run(db, png("1"), fakeExtractor(goodReceipt()));
    const r = await run(db, png("2"), fakeExtractor(goodReceipt()));
    expect(r.status).toBe("pending");
    expect(r.probableDuplicates).toEqual([first.expenseId]);
    expect(r.issues.map((i) => i.code)).toContain("probable_duplicate");
  });
  it("las líneas que no cuadran no bloquean", async () => {
    const r = await run(memDb(), png("3"), fakeExtractor(goodReceipt({ total_amount: 13.1 })));
    expect(r).toMatchObject({ status: "pending", itemsReconciled: false, itemsDiff: 4.1 });
  });
  it("fecha ambigua va a revisión", async () => {
    const r = await run(memDb(), png("4"), fakeExtractor(goodReceipt({ date_ambiguous: true, expense_date: null })));
    expect(r.status).toBe("review");
  });
  it("si la extracción falla, el ticket se guarda en revisión", async () => {
    const db = memDb();
    const r = await run(db, png("5"), fakeExtractor(new ExtractionError("JSON no válido")));
    expect(r.status).toBe("review");
    expect(db.prepare("SELECT status, review_reason FROM expenses").get()).toMatchObject({ status: "review" });
  });
  it("si el lector no está disponible no se guarda nada", async () => {
    const db = memDb();
    await expect(run(db, png("6"), fakeExtractor(new ExtractorUnavailableError("sin clave")))).rejects.toThrow("sin clave");
    expect((db.prepare("SELECT COUNT(*) n FROM expenses").get() as { n: number }).n).toBe(0);
  });
});
