import { z } from 'zod';

const mcpGuestCartCredentialSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe(
    'Private opaque capability from the previous cart tool result, retained verbatim across messages. Required to change or remove items in that same cart; omit only to start a new guest cart. Never expose it to the shopper.'
  );
export const mcpGuestCartInputBase = z.object({
  product_id: z
    .string()
    .uuid()
    .describe('The public product ID (UUID) to add, update or remove'),
  quantity: z
    .number()
    .int()
    .min(0)
    .max(10)
    .default(1)
    .describe('Desired total quantity, or 0 to remove this product'),
  cart_token: mcpGuestCartCredentialSchema.optional(),
  expectedVersion: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Expected canonical cart version for shared-cart writes; omit for legacy guest carts'
    ),
  operationId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .optional()
    .describe(
      'Idempotency key for shared-cart writes; omit for legacy guest carts'
    ),
});
