import { z } from 'zod';

export const chatwootCartQuantityMutationRequestSchema = z
  .object({
    cartVersion: z.number().int().positive().safe(),
    conversationId: z.number().int().positive().safe(),
    // Existing carts can exceed the UI's 10-item ceiling; a shopper can still
    // reduce or remove those lines by confirming their full current quantity.
    expectedQuantity: z.number().int().min(1).max(1000),
    lineId: z.uuid(),
    quantity: z.number().int().min(0).max(10),
    requestId: z
      .string()
      .min(8)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    sessionToken: z.string().min(1).max(12_000),
  })
  .strict();
