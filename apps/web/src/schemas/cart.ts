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

const cartItemIdentitySchema = z.strictObject({
  condition: z.enum(['new', 'used', 'open_box', 'refurbished']).optional(),
  options: z.record(z.string().min(1), z.string()).optional(),
  productId: z.uuid(),
  variantId: z.uuid().optional(),
});

const cartLineAttachmentsSchema = z.strictObject({
  negotiatedUnitPriceMinor: z.number().int().positive().optional(),
  negotiationStatus: z.enum(['pending', 'accepted', 'rejected']).optional(),
  voucherAwardId: z.string().trim().min(1).max(128).optional(),
  voucherToken: z.string().trim().min(1).max(256).optional(),
});

const cartInputLineSchema = z
  .strictObject({
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

export const createCartRequestSchema = z.strictObject({
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 code')
    .optional(),
  lines: z.array(cartInputLineSchema).max(20).optional(),
  operationId: operationIdSchema,
});
