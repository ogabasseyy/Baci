import { z } from 'zod';

const productSlug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)*$/);
const requestId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const availability = z.enum(['in_stock', 'out_of_stock']);
const productCondition = z.enum(['new', 'used', 'open_box']);

export const chatwootProductCardSchema = z
  .object({
    availability,
    condition: productCondition.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    image: z
      .url()
      .max(2_048)
      .refine((value) => new URL(value).protocol === 'https:')
      .optional(),
    name: z.string().min(1).max(120),
    price: z.number().finite().nonnegative(),
    slug: productSlug,
    variants: z
      .array(
        z
          .object({
            attributes: z.record(z.string().max(40), z.string().max(80)),
            availability,
            condition: productCondition.optional(),
            id: z.uuid(),
            price: z.number().finite().nonnegative(),
          })
          .strict()
      )
      .max(128),
  })
  .strict();

const unavailableCode = z.enum([
  'forbidden',
  'invalid_request',
  'invalid_context',
  'product_unavailable',
  'quota_exceeded',
  'temporarily_unavailable',
  'unsupported_condition_offers',
]);

export const chatwootProductLookupResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      product: chatwootProductCardSchema,
      requestId,
    })
    .strict(),
  z
    .object({
      code: unavailableCode,
      ok: z.literal(false),
      requestId: requestId.optional(),
    })
    .strict(),
]);

export type ChatwootProductCard = z.infer<typeof chatwootProductCardSchema>;
