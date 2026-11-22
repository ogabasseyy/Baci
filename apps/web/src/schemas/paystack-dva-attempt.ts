import { z } from 'zod';

/** Receipt returned by begin_chat_paystack_dva_attempt. */
export const paystackDvaAttemptReceiptSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('legacy') }),
  z.object({ kind: z.literal('claimed') }),
  z.object({ kind: z.literal('pending') }),
  z.object({ kind: z.literal('refused') }),
  z.object({
    kind: z.literal('saved'),
    reference: z.string().min(1),
    dva: z.object({
      account_number: z.string().min(1),
      account_name: z.string().min(1),
      bank_name: z.string().min(1),
    }),
  }),
]);
