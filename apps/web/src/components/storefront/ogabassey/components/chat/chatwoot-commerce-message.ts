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
const schema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('baci-cart-quantity'),
    data: z.object({ requestId, conversationId, sessionToken, lineToken: requestId, expectedQuantity: z.number().int().min(1).max(1000), quantity: z.number().int().min(0).max(1000) }).strict(),
  }).strict(),
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
      data: z.object({ slug: productSlug, requestId, conversationId, sessionToken }).strict(),
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
const contextControl = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('baci-commerce-context-request'),
    data: z.object({
      requestId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
      conversationId,
      websiteToken: z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/),
      visitorTokenSha256: z.string().length(64).regex(/^[0-9a-f]{64}$/),
    }).strict(),
  }).strict(),
  z.object({
    event: z.literal('baci-commerce-context-ready'),
    data: z.object({
      requestId: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
      conversationId,
      contextToken: z.string().min(1).max(12_000),
      expiresAt: z.number().int().positive().safe(),
    }).strict(),
  }).strict(),
]);

export function readChatwootCommerceContextMessage(
  event: MessageEvent,
  origin: string,
  frame: Window | null
) {
  if (
    !frame ||
    event.origin !== origin ||
    event.source !== frame ||
    typeof event.data !== 'string' ||
    event.data.length > 24_000
  ) return null;
  const prefix = [
    'baci-commerce-context-request:',
    'baci-commerce-context-ready:',
  ].find((candidate) => event.data.startsWith(candidate));
  if (!prefix) return null;
  try {
    const result = contextControl.safeParse({
      event: prefix.slice(0, -1),
      data: JSON.parse(event.data.slice(prefix.length)),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function readChatwootCommerceMessage(
  event: MessageEvent,
  origin: string,
  frame: Window | null
) {
  if (
    !frame ||
    event.origin !== origin ||
    event.source !== frame ||
    typeof event.data !== 'string' ||
    event.data.length > 2048
  )
    return null;
  const prefixes = [
    'baci-cart-quantity:',
    'baci-cart-request:',
    'baci-checkout-review-request:',
    'baci-product-request:',
    'baci-cart-add:',
  ];
  const prefix = prefixes.find((candidate) => event.data.startsWith(candidate));
  if (!prefix) return null;
  try {
    const eventName = prefix.slice(0, -1);
    const result = schema.safeParse({
      event: eventName,
      data: JSON.parse(event.data.slice(prefix.length)),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
