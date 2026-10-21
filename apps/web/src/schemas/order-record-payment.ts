import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';

export const recordPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  payment_method: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((val) => sanitizeText(val ?? 'manual', 50)),
  reference: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeText(val, 100) : val)),
  notes: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeText(val, 500) : val)),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
