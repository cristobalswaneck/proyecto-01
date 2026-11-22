import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractedReceiptSchema } from "../src/models.js";
import { validateItems } from "../src/validators.js";

const dir = new URL("../fixtures/tickets/", import.meta.url);
const refs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("tickets de referencia (fixtures/)", () => {
  it("hay al menos 6", () => expect(refs.length).toBeGreaterThanOrEqual(6));
  for (const f of refs) {
    it(`${f}: JSON válido, líneas cuadradas y con imagen`, () => {
      const r = ExtractedReceiptSchema.parse(JSON.parse(fs.readFileSync(new URL(f, dir), "utf-8")));
      expect(validateItems(r).reconciled).toBe(true);
      const base = f.replace(/\.json$/, "");
      expect(["png", "jpg", "jpeg", "webp"].some((e) => fs.existsSync(new URL(`${base}.${e}`, dir)))).toBe(true);
    });
  }
});
