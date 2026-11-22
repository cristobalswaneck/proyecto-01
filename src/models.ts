// Forma de los datos. Sin lógica de negocio: las reglas viven en validators.ts.
import { z } from "zod";
import { PAYMENT_METHODS, UNITS } from "./config.js";

const num = z.number().nullable().default(null);
const str = z.string().nullable().default(null);

export const ExtractedItemSchema = z.object({
  raw_description: z.string(), // tal cual, en el idioma del ticket
  product_normalized: str, // propuesto en español
  product_category: str,
  quantity: num,
  unit: z.enum(UNITS).nullable().default(null),
  unit_price: num,
  discount: num, // importe positivo descontado
  line_total: num,
});

export const ExtractedReceiptSchema = z.object({
  vendor: str,
  expense_date: str, // ISO aaaa-mm-dd
  date_ambiguous: z.boolean().default(false),
  purchase_time: str,
  base_amount: num,
  vat_amount: num,
  total_amount: num,
  currency: str,
  category: str,
  payment_method: z.enum(PAYMENT_METHODS).nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  items: z.array(ExtractedItemSchema).default([]),
});

export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
export type ExtractedReceipt = z.infer<typeof ExtractedReceiptSchema>;

export type Severity = "block" | "review" | "warn";

export interface ValidationIssue {
  code: string;
  severity: Severity;
  message: string;
  line_no?: number;
}

export interface PipelineResult {
  status: "pending" | "review" | "rejected";
  expenseId: number | null;
  issues: ValidationIssue[];
  itemsReconciled: boolean;
  itemsDiff: number | null; // total del ticket - suma de líneas
  duplicateOf: number | null; // duplicado exacto (hash)
  probableDuplicates: number[];
}
