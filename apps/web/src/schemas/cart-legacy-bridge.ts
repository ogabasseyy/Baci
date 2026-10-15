import { z } from 'zod';
export const legacyOwnerContextSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  lines: z
    .array(
      z.object({
        item: z.object({ productId: z.uuid() }),
        quantity: z.number().int().min(1).max(10),
      })
    )
    .max(20)
    .optional(),
  legacyVersion: z.string().optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  cartId: z.uuid().optional(),
  grantId: z.uuid().optional(),
  grantExpiresAt: z.string().optional(),
  allowedOperations: z
    .array(
      z.enum([
        'add',
        'set_quantity',
        'remove',
        'clear',
        'replace',
        'set_assurance',
        'set_negotiated_price',
      ])
    )
    .optional(),
});
export const legacyMcpBridgeRequestSchema = z
  .object({
    productId: z.uuid().optional(),
    quantity: z.number().int().min(0).max(10).optional(),
    expectedVersion: z.number().int().positive().optional(),
    operationId: z.string().trim().min(1).max(128).optional(),
    handoff: z.boolean().optional(),
  })
  .refine((x) => (x.productId === undefined) === (x.quantity === undefined));
