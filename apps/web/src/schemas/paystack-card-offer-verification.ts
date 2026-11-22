import { z } from 'zod';

export const paystackVerifyResponseSchema = z.object({
  data: z.object({
    amount: z.number().int().positive(),
    authorization: z.object({
      bank: z.string().min(1),
      brand: z.string().min(1),
      channel: z.string().min(1),
    }),
    channel: z.string().min(1),
    currency: z.string().min(1),
    customer: z.object({ email: z.email() }),
    domain: z.string().min(1),
    id: z.union([z.number().int().positive(), z.string().min(1)]),
    paid_at: z.iso.datetime({ offset: true }),
    reference: z.string().min(1),
    status: z.literal('success'),
  }),
  status: z.literal(true),
});
