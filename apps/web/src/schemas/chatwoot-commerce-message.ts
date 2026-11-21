import { z } from 'zod';
import { chatwootProductSlugSchema } from './chatwoot-product-slug';
import { postgresUuidSchema } from './postgres-uuid';

const productSlug = chatwootProductSlugSchema;
const requestId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const quantityRequestId = requestId.min(8);
const addRequestId = requestId.min(8);
const sessionToken = z.string().min(1).max(12_000);
const conversationId = z.number().int().positive().safe();
const shortText = (max: number) => z.string().trim().min(1).max(max);
const paymentReference = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.=-]+$/);

export const chatwootCommerceMessageSchema = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('baci-cart-quantity'),
      data: z
        .object({
          requestId: quantityRequestId,
          conversationId,
          sessionToken,
          lineToken: requestId,
          cartVersion: z.number().int().positive().safe(),
          expectedQuantity: z.number().int().min(1).max(1000),
          quantity: z.number().int().min(0).max(10),
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
      event: z.literal('baci-delivery-options-request'),
      data: z
        .object({
          requestId,
          conversationId,
          sessionToken,
          state: z.string().trim().min(2).max(100),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('baci-checkout-place-request'),
      data: z
        .object({
          requestId: addRequestId,
          conversationId,
          sessionToken,
          cartVersion: z.number().int().positive().safe(),
          customer: z
            .object({
              firstName: shortText(60),
              lastName: shortText(60),
              email: shortText(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
              phone: z.string().trim().min(7).max(20),
            })
            .strict(),
          address: z
            .object({
              line1: z.string().trim().min(3).max(200),
              city: z.string().trim().min(2).max(100),
              state: z.string().trim().min(2).max(100),
            })
            .strict(),
          delivery: z
            .object({
              displayName: shortText(120),
              priceMajor: z.number().finite().nonnegative().max(1_000_000_000),
              pickup: z.boolean(),
              pickupLocation: z.string().min(1).max(240).optional(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('baci-checkout-payment-status-request'),
      data: z
        .object({
          requestId: addRequestId,
          conversationId,
          sessionToken,
          reference: paymentReference,
        })
        .strict(),
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
          variantId: postgresUuidSchema.optional(),
          displayedPrice: z.number().finite().nonnegative(),
          requestId: addRequestId,
          conversationId,
          sessionToken,
        })
        .strict(),
    })
    .strict(),
]);

export type ChatwootCommerceMessage = z.infer<
  typeof chatwootCommerceMessageSchema
>;
