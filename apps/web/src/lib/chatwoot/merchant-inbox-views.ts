import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import { INBOX_FOLLOW_UP_LABEL } from './merchant-inbox-labels';

export const MERCHANT_INBOX_VIEWS = [
  'all',
  'needs_reply',
  'unread',
  'follow_up',
  'done',
  /** Chats from signed-in customers who have ordered; finished in the route. */
  'returning',
] as const;
export type MerchantInboxView = (typeof MERCHANT_INBOX_VIEWS)[number];

type ProviderQuery = {
  status: 'open' | 'resolved' | 'pending' | 'snoozed' | 'all';
  labels?: string[];
};

/** What to ask the provider for, before the rows are narrowed by `matchesView`. */
export function providerQueryForView(view: MerchantInboxView): ProviderQuery {
  switch (view) {
    case 'done':
      return { status: 'resolved' };
    case 'follow_up':
      return { status: 'all', labels: [INBOX_FOLLOW_UP_LABEL] };
    default:
      return { status: 'all' };
  }
}

/**
 * The view's own rule. Applied to every row even when the provider already
 * filtered, so a provider that ignores a filter cannot widen a view.
 */
export function matchesView(
  conversation: MerchantInboxConversation,
  view: MerchantInboxView
): boolean {
  const live =
    conversation.status === 'open' || conversation.status === 'pending';
  switch (view) {
    case 'all':
      return true;
    case 'needs_reply':
      return live && conversation.lastMessage?.sender === 'customer';
    case 'unread':
      return conversation.status !== 'resolved' && conversation.unreadCount > 0;
    case 'follow_up':
      return conversation.status !== 'resolved' && !!conversation.followUp;
    case 'done':
      return conversation.status === 'resolved';
    case 'returning':
      // The customer rule needs the verified link, so the route applies it.
      return conversation.status !== 'resolved';
  }
}
