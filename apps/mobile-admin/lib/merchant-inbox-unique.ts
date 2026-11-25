import type { InboxConversation } from '@/schemas/merchant-inbox';

/**
 * One row per chat. The chat engine pages by recent activity, so new messages
 * between two page requests can put the same chat on both; the first one wins.
 */
export function uniqueConversations(
  conversations: readonly InboxConversation[]
): InboxConversation[] {
  const seen = new Set<number>();
  return conversations.filter(({ id }) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
