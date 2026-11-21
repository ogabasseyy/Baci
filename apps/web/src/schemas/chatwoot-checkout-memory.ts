import { z } from 'zod';

const text = (max: number) => z.string().min(1).max(max);

/** One chat order as kept in the tab's session storage. */
export const chatwootCheckoutRememberedOrderSchema = z
  .object({
    merchantId: text(64),
    conversationId: z.number().int().positive().safe(),
    cartId: text(64),
    order: z
      .object({
        orderId: text(64),
        orderNumber: text(64),
        trackingToken: text(256).nullable(),
        amountDueMajor: z.number().finite().positive(),
        currency: text(8).nullable(),
        paymentMethod: z.literal('oxygen').optional(),
      })
      .strict(),
    payment: z
      .object({
        bank: z
          .object({
            bankName: text(120),
            accountNumber: text(120),
            accountName: text(120),
          })
          .strict(),
        reference: text(200),
        issuedAt: z.number().int().nonnegative().safe(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/** The stored list, oldest first, as [idempotency key, order] pairs. */
export const chatwootCheckoutMemorySchema = z
  .array(z.tuple([text(200), chatwootCheckoutRememberedOrderSchema]))
  .max(20);
