import { z } from 'zod';
import { hasAtMostTwoDecimalPlaces } from '@/lib/orders/has-at-most-two-decimal-places';

export const orderRefundSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry') }).strict(),
  z
    .object({
      action: z.literal('manual'),
      amount: z
        .number()
        .finite()
        .positive()
        .refine(hasAtMostTwoDecimalPlaces, 'Use at most two decimal places'),
      refundedAt: z.iso
        .datetime({ offset: true })
        .refine(
          (value) => Date.parse(value) <= Date.now(),
          'Refund date cannot be in the future'
        ),
      method: z.enum(['paystack', 'bank_transfer', 'cash', 'other']),
      reference: z.string().trim().min(1).max(100),
      note: z.string().trim().max(500).optional(),
      confirmed: z.literal(true),
      // Optional leg pin: a Paystack attestation verifies against one
      // capture's listing, so multi-leg orders must name the refunded
      // leg instead of letting FIFO allocation guess it. Ownership
      // and fit are validated inside the RPC.
      paymentTransactionId: z.string().uuid().optional(),
    })
    .strict(),
]);
