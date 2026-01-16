import { z } from "zod";

export const ScanExpenseSchema = z.object({
  title: z.string().min(1).max(120).optional().default(""),
  amount: z.number().nonnegative().optional().default(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().default(""),
  category: z.enum(["transport", "repas", "hébergement", "autre"]).optional().default("autre"),
  description: z.string().max(500).optional().default(""),
  merchant: z.string().max(120).optional().default(""),
  currency: z.string().max(10).optional().default("EUR"),
});
