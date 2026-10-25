import { z } from 'zod';
export const oxygenPlanQuoteSchema = z
  .object({
    workflowId: z.uuid(),
    idempotencyKey: z.uuid(),
    equityPercentage: z
      .number()
      .min(25)
      .max(90)
      .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value))),
    tenure: z.number().int().min(1).max(12),
  })
  .strict();
export type OxygenPlanQuote = z.infer<typeof oxygenPlanQuoteSchema>;
