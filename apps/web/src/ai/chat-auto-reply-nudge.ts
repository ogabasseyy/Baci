import type { ChatAutoReply } from '@/schemas/chat-auto-reply';

/**
 * The line the old storefront chat showed under product suggestions. Kept
 * word for word so customers get the same prompt in the Chatwoot chat.
 */
export const CHAT_NARROW_DOWN_NUDGE =
  'Want to narrow these down? Tell me your budget, preferred brand, or what matters most.';

/**
 * Adds the narrow-down line after an answer that suggests products. The store
 * adds it (not the model) so it is always the same words, and only when:
 * - the customer was browsing or asking for a suggestion (not adding to the
 *   cart, asking about one product, or something else);
 * - the store really had products to show;
 * - the assistant is answering itself rather than handing over.
 */
export function withNarrowDownNudge(
  draft: ChatAutoReply,
  productCount: number
): ChatAutoReply {
  const suggestsProducts =
    draft.intent === 'discover' || draft.intent === 'recommend';
  if (!suggestsProducts || productCount === 0) return draft;
  if (draft.needsHuman || draft.reply.length === 0) return draft;
  if (draft.reply.includes(CHAT_NARROW_DOWN_NUDGE)) return draft;
  return { ...draft, reply: `${draft.reply}\n\n${CHAT_NARROW_DOWN_NUDGE}` };
}

/**
 * What the customer hears when they ask to add something to the cart. The
 * assistant cannot change a cart, so the model's own wording (which may claim
 * it did) is never shown for this intent.
 */
export const CHAT_CART_LIMIT_REPLY =
  "I can't add items to your cart from this chat. Open the product and tap Add to cart, or tell me here and a team member will help you.";

export function withCartLimit(draft: ChatAutoReply): ChatAutoReply {
  if (draft.intent !== 'add_to_cart' || draft.needsHuman) return draft;
  return { ...draft, reply: CHAT_CART_LIMIT_REPLY };
}
