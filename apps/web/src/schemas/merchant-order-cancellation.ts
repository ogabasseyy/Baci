import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';

export const merchantOrderCancellationSchema = z.strictObject({
  cancelled_by: z.literal('merchant').optional(),
  confirm_cancellation: z.literal(true),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) =>
      value ? sanitizeText(value, 500).trim() || undefined : undefined
    ),
});
