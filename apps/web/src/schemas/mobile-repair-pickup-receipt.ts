import { z } from 'zod';

export const mobileRepairPickupReceiptSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('claimed') }),
  z.object({ state: z.literal('pending') }),
  z.object({
    state: z.literal('complete'),
    result: z.discriminatedUnion('success', [
      z.object({
        success: z.literal(true),
        id: z.string(),
        ticketNumber: z.number().int().positive(),
        resumeToken: z.string(),
        payment: z.object({
          amount: z.number().positive(),
          authorizationUrl: z.url(),
          reference: z.string(),
        }),
      }),
      z.object({
        success: z.literal(false),
        code: z.string(),
        error: z.string(),
        id: z.string().optional(),
        ticketNumber: z.number().int().positive().optional(),
        resumeToken: z.string().optional(),
        quote: z
          .object({ formattedPrice: z.string(), price: z.number().positive() })
          .optional(),
      }),
    ]),
  }),
]);
