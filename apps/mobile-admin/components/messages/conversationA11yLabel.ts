import { formatFollowUp, formatInboxTag } from '@/lib/merchant-inbox-format';
import { isFollowUpDue } from '@/lib/merchant-inbox-sort';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { PRIORITY_LABEL } from './ConversationMeta';

/**
 * What a screen reader says for a chat row. The row is one touchable whose
 * label replaces its children, so everything the row shows has to be in it:
 * who, what is waiting, priority, follow-up, tags, and the text that explains
 * the row (the last message, or the words a search matched).
 */
export function conversationA11yLabel(
  conversation: InboxConversation,
  { preview, waiting }: { preview: string; waiting: boolean }
): string {
  const parts = [`Conversation with ${conversation.customerName}`];
  if (waiting) parts.push('needs reply');
  if (conversation.unreadCount > 0) {
    parts.push(`${conversation.unreadCount} new`);
  }
  if (conversation.priority) {
    parts.push(`${PRIORITY_LABEL[conversation.priority]} priority`);
  }
  if (conversation.followUp && conversation.status !== 'resolved') {
    parts.push(
      formatFollowUp(conversation.snoozedUntil, isFollowUpDue(conversation))
    );
  }
  const tags = conversation.tags ?? [];
  if (tags.length > 0)
    parts.push(`tags ${tags.map(formatInboxTag).join(', ')}`);
  return `${parts.join(', ')}. ${preview}`;
}
