import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import { readCustomerLinkToken } from './merchant-inbox-customer-link';
import { projectMerchantInboxConversation } from './merchant-inbox-projection';
import { type MerchantInboxView, matchesView } from './merchant-inbox-views';

/**
 * Turns one provider page into the rows the inbox shows: only chats of the
 * bound inbox, narrowed by the view's own rule, newest activity first. Signed
 * customer links are returned beside the rows, never inside them, so a token
 * cannot reach a response by accident.
 */
export function buildMerchantInboxListRows(
  payload: readonly unknown[],
  inboxId: number,
  view?: MerchantInboxView
): {
  conversations: MerchantInboxConversation[];
  links: Record<number, string>;
} {
  const links: Record<number, string> = {};
  const conversations = payload
    .map((raw) => {
      const conversation = projectMerchantInboxConversation(raw, inboxId);
      const token = conversation ? readCustomerLinkToken(raw) : null;
      if (conversation && token) links[conversation.id] = token;
      return conversation;
    })
    .filter((value): value is MerchantInboxConversation => value !== null)
    .filter((value) => !view || matchesView(value, view))
    // Ordering must not depend on the provider honouring `sort_by`.
    .sort(
      (a, b) =>
        (b.lastActivityAt ? Date.parse(b.lastActivityAt) : 0) -
        (a.lastActivityAt ? Date.parse(a.lastActivityAt) : 0)
    );
  return { conversations, links };
}
