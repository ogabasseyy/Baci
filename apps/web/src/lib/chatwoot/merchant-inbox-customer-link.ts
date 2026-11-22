import { CHAT_CUSTOMER_LINK_ATTRIBUTE } from '@/schemas/chat-customer-link';

/**
 * The signed link the storefront stored on the shopper's contact, if any.
 * It is only a claim until the token verifier accepts it; never trust or
 * return it as is.
 */
export function readCustomerLinkToken(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const meta = (raw as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== 'object') return null;
  const sender = (meta as { sender?: unknown }).sender;
  if (sender === null || typeof sender !== 'object') return null;
  const attributes = (sender as { custom_attributes?: unknown })
    .custom_attributes;
  if (attributes === null || typeof attributes !== 'object') return null;
  const token = (attributes as Record<string, unknown>)[
    CHAT_CUSTOMER_LINK_ATTRIBUTE
  ];
  return typeof token === 'string' && token.length > 0 ? token : null;
}
