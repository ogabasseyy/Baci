import { z } from 'zod';
export const legacyOwnerContextSchema = z.object({
  ok: z.boolean(),
  code: z.string().optional(),
  lines: z
    .array(
      z.object({
        item: z.object({
          productId: z.uuid(),
          variantId: z.uuid().optional(),
          condition: z
            .enum(['new', 'used', 'open_box', 'refurbished'])
            .optional(),
          options: z.record(z.string(), z.string()).optional(),
        }),
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
    // Read-only liveness probe: resolves the legacy owner context
    // without migrating, mutating, or issuing any credential.
    probe: z.literal(true).optional(),
  })
  .refine((x) => (x.productId === undefined) === (x.quantity === undefined))
  .refine(
    (x) =>
      x.probe !== true ||
      (x.productId === undefined &&
        x.expectedVersion === undefined &&
        x.operationId === undefined &&
        x.handoff !== true),
    { error: 'A probe cannot carry a mutation or handoff' }
  );
