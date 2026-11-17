import { chatwootCommerceMessageSchema } from '@/schemas/chatwoot-commerce-message';

const MAX_COMMERCE_MESSAGE_LENGTH = 24_000;

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
    event.data.length > MAX_COMMERCE_MESSAGE_LENGTH
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
    const result = chatwootCommerceMessageSchema.safeParse({
      event: eventName,
      data: JSON.parse(event.data.slice(prefix.length)),
    });
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
