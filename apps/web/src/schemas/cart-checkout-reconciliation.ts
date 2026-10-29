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
  })
  .strict();
