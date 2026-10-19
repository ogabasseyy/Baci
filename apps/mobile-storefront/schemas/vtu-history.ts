import { z } from 'zod';

export const VtuHistoryResponseSchema = z.object({
  transactions: z.array(
    z.object({
      request_reference: z.string(),
      voucher_pin: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      refund_pending: z.boolean().nullable().optional(),
      refund_skipped: z.boolean().nullable().optional(),
    })
  ),
});
