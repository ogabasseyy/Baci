import { z } from 'zod';

const variantIdSchema = z.uuid({
  error: 'variantId/variant_id must be a UUID',
});

const cartItemSchema = z
  .object({
    condition: z.string().optional(),
    id: z.string(),
    price: z.number(),
    variant_attributes: z.record(z.string(), z.string()).optional(),
    variant_id: variantIdSchema.optional(),
    variantAttributes: z.record(z.string(), z.string()).optional(),
    variantId: variantIdSchema.optional(),
  })
  .superRefine((item, ctx) => {
    if (
      item.variantId &&
      item.variant_id &&
      item.variantId !== item.variant_id
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'conflicting variantId and variant_id',
        path: ['variant_id'],
      });
    }
  });

export const cartValidateSchema = z.object({
  productIds: z.array(z.string()).max(50).optional(),
  cartItems: z.array(cartItemSchema).max(50).optional(),
});

export const cartItemIdentitySchema = z.strictObject({
  condition: z.enum(['new', 'used', 'open_box', 'refurbished']).optional(),
  options: z.record(z.string().min(1), z.string()).optional(),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
});

const cartLineAttachmentsSchema = z.strictObject({
  negotiatedUnitPriceMinor: z.number().int().positive().optional(),
  negotiationStatus: z.enum(['pending', 'accepted', 'rejected']).optional(),
  voucherAwardId: z.string().trim().min(1).max(128).optional(),
  voucherToken: z.string().trim().min(1).max(512).optional(),
});

export const cartInputLineSchema = z
  .strictObject({
    hasAssurance: z.boolean().optional(),
    item: cartItemIdentitySchema,
    quantity: z.number().int().min(1).max(10),
  })
  .extend(cartLineAttachmentsSchema.shape);

const cartCommandSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      item: cartItemIdentitySchema,
      quantity: z.number().int().min(1).max(10),
      type: z.literal('add'),
    })
    .extend(cartLineAttachmentsSchema.shape),
  z.strictObject({
    lineId: z.string().trim().min(1).max(64),
    quantity: z.number().int().min(1).max(10),
    type: z.literal('set_quantity'),
  }),
  z.strictObject({
    hasAssurance: z.boolean(),
    lineId: z.string().trim().min(1).max(64),
    type: z.literal('set_assurance'),
  }),
  z.strictObject({
    lineId: z.string().trim().min(1).max(64),
    negotiatedUnitPriceMinor: z.number().int().min(1).nullable(),
    type: z.literal('set_negotiated_price'),
  }),
  z.strictObject({
    lineId: z.string().trim().min(1).max(64),
    type: z.literal('remove'),
  }),
  z.strictObject({ type: z.literal('clear') }),
  z.strictObject({
    lines: z.array(cartInputLineSchema).max(20),
    type: z.literal('replace'),
  }),
]);

const operationIdSchema = z.string().trim().min(1).max(128);

export const sharedCartMutationRequestSchema = z.strictObject({
  command: cartCommandSchema,
  expectedVersion: z.number().int().min(1),
  operationId: operationIdSchema,
});

export const sharedCartPrepareRequestSchema = z.strictObject({
  cartId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  operationId: operationIdSchema,
});

export const createCartRequestSchema = z.strictObject({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 code')
    .optional(),
  lines: z.array(cartInputLineSchema).max(20).optional(),
  operationId: operationIdSchema,
});

/**
 * Bootstrap body. The merchant slug is a lookup hint for hosts without
 * trusted merchant headers (platform root host, previews, native); it is
 * resolved through the published-store mapping and never confers
 * authority by itself.
 */
export const cartBootstrapRequestSchema = z.strictObject({
  merchantSlug: z.string().trim().min(1).max(128).optional(),
});

const handoffDestinationSchema = z.strictObject({
  // Only the storefront app has a native handoff consumer; do not mint
  // destinations nothing can redeem.
  app: z.enum(['storefront']).optional(),
  type: z.enum(['web', 'native']),
});

export const cartHandoffIssueRequestSchema = z.strictObject({
  destination: handoffDestinationSchema,
  operationId: operationIdSchema,
});

const handoffResolutionSchema = z.strictObject({
  item: cartItemIdentitySchema,
  keep: z.enum(['incoming', 'existing']),
});

export const cartHandoffRedeemRequestSchema = z
  .strictObject({
    attemptId: z.string().trim().min(1).max(128),
    choice: z.enum(['connect', 'merge', 'keep_existing']),
    destCartId: z.uuid().optional(),
    expectedDestVersion: z.number().int().min(1).optional(),
    expectedIncomingVersion: z.number().int().min(1).optional(),
    handoffId: z.uuid(),
    lines: z.array(cartInputLineSchema).max(20).optional(),
    resolutions: z.array(handoffResolutionSchema).max(20).optional(),
    token: z.string().regex(/^ch1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  })
  .superRefine((value, context) => {
    if (value.choice !== 'merge') return;
    for (const key of [
      'lines',
      'destCartId',
      'expectedIncomingVersion',
      'expectedDestVersion',
    ] as const) {
      if (value[key] === undefined)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'A complete reviewed merge is required',
        });
    }
  });
