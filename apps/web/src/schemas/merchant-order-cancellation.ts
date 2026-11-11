import { z } from 'zod';
import { sanitizeText } from '@/lib/sanitize-core';

export const merchantOrderCancellationSchema = z.strictObject({
  cancelled_by: z.literal('merchant').optional(),
  confirm_cancellation: z.literal(true),
  // 'automatic' queues the Paystack refund (default, also what builds that
  // predate this field get); 'manual' cancels only and leaves the refund for
  // the merchant to record from the order's Refund card.
  refund: z.enum(['automatic', 'manual']).default('automatic'),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) =>
      value ? sanitizeText(value, 500).trim() || undefined : undefined
    ),
});
