import { z } from 'zod';
export const experienceCartCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('add'),
    productId: z.uuid(),
    variantId: z.uuid().optional(),
    condition: z.enum(['new', 'used', 'open_box', 'refurbished']).optional(),
    options: z
      .record(z.string().max(64), z.string().max(200))
      .refine((v) => Object.keys(v).length <= 16)
      .optional(),
    quantity: z.number().int().min(1).max(10),
  }),
  z.strictObject({ kind: z.literal('remove'), lineId: z.uuid() }),
  z.strictObject({
    kind: z.literal('set_quantity'),
    lineId: z.uuid(),
    quantity: z.number().int().min(1).max(10),
  }),
]);
export const experienceEngineCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('add'),
    item: z.strictObject({
      productId: z.string().min(1).max(128),
      variantId: z.string().min(1).max(128).optional(),
      condition: z.enum(['new', 'used', 'open_box', 'refurbished']).optional(),
      options: z
        .record(z.string().max(64), z.string().max(200))
        .refine((v) => Object.keys(v).length <= 16)
        .optional(),
    }),
    quantity: z.number().int().min(1).max(10),
  }),
  z.strictObject({
    type: z.literal('remove'),
    lineId: z.string().min(1).max(128),
  }),
  z.strictObject({
    type: z.literal('set_quantity'),
    lineId: z.string().min(1).max(128),
    quantity: z.number().int().min(1).max(10),
  }),
]);
