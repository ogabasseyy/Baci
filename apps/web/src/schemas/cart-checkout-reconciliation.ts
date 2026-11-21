import { z } from 'zod';

export const cartCheckoutReconciliationSchema = z
  .object({
    cartId: z.uuid(),
    sessionId: z.uuid(),
    generation: z.int().positive().max(999_999_999),
    cartVersion: z.int().positive().max(999_999_999),
    customerEmail: z
      .string()
      .trim()
      .email()
      .transform((value) => value.toLowerCase()),
    idempotencyKey: z.string().min(1).max(128),
    paymentMethod: z.literal('bank_transfer').optional(),
  })
  .strict();

export const cartCheckoutReconciliationReceiptSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('retired'),
      cartId: z.uuid(),
      checkoutSessionId: z.uuid(),
      checkoutGeneration: z.int().positive(),
    }),
    z.object({ kind: z.literal('submitted'), orderId: z.uuid() }),
    z.object({ kind: z.literal('unavailable') }),
  ]
);

export const bankTransferCheckoutReceiptSchema = z.object({
  kind: z.literal('submitted'),
  order: z.object({
    id: z.uuid(),
    order_number: z.string().min(1),
    tracking_token: z.string().min(1),
    currency: z.literal('NGN'),
  }),
  amountDueToGateway: z.number().positive(),
});
