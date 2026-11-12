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
  .regex(/^[a-zA-Z0-9_-]+$/);
const sessionToken = z.string().min(1).max(12_000);
const conversationId = z.number().int().positive().safe();

export const chatwootCommerceMessageSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('baci-cart-quantity'),
      data: z
        .object({
          requestId,
          conversationId,
          sessionToken,
          lineToken: requestId,
          expectedQuantity: z.number().int().min(1).max(1000),
          quantity: z.number().int().min(0).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('baci-cart-request'),
      data: z.object({ requestId, conversationId, sessionToken }).strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('baci-checkout-review-request'),
      data: z.object({ requestId, conversationId, sessionToken }).strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('baci-product-request'),
      data: z
        .object({ slug: productSlug, requestId, conversationId, sessionToken })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('baci-cart-add'),
      data: z
        .object({
          slug: productSlug,
          variantId: z.string().min(1).max(128),
          displayedPrice: z.number().finite().nonnegative(),
          requestId,
          conversationId,
          sessionToken,
        })
        .strict(),
    })
    .strict(),
]);
