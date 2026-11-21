import { z } from 'zod';
export const MCP_IMPORT_HANDOFF_OPERATION_PREFIX = 'legacy-handoff:mcp-import:';
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
    handoff: z.union([z.boolean(), z.literal('import_mcp')]).optional(),
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
        !x.handoff),
    { error: 'A probe cannot carry a mutation or handoff' }
  );
