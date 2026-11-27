import { CHAT_CUSTOMER_LINK_ATTRIBUTE } from '@/schemas/chat-customer-link';

/**
 * The signed link the storefront stored on this conversation, if any. It is
 * only a claim until the token verifier accepts it; never trust or return it
 * as is.
 *
 * Only the conversation's own attributes count. The contact's are ignored: the
 * chat engine merges contacts by email or phone, so a note there would follow a
 * stranger who typed the shopper's email.
 */
export function readCustomerLinkToken(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const attributes = (raw as { custom_attributes?: unknown }).custom_attributes;
  if (attributes === null || typeof attributes !== 'object') return null;
  const token = (attributes as Record<string, unknown>)[
    CHAT_CUSTOMER_LINK_ATTRIBUTE
  ];
  return typeof token === 'string' && token.length > 0 ? token : null;
}
