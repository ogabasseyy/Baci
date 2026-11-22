import type { InboxMessage } from '@/schemas/merchant-inbox';

/** Short label for a conversation row: "Just now", "5m", "3h", or a date. */
export function formatInboxTime(
  iso: string | null,
  now: Date = new Date()
): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** What the thread shows for a message the app cannot render as text. */
export function inboxMessageText(message: InboxMessage): string {
  if (message.text.trim()) return message.text;
  return message.kind === 'product_card' ? 'Shared a product' : 'Attachment';
}

export function inboxSenderLabel(sender: InboxMessage['sender']): string {
  switch (sender) {
    case 'store':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'Update';
    default:
      return '';
  }
}

/** Chat shows messages oldest to newest; the API may return either order. */
export function sortInboxMessages(messages: InboxMessage[]): InboxMessage[] {
  return [...messages].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.id - b.id
  );
}
