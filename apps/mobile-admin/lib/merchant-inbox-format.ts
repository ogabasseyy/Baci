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

/** Up to two capital letters for an avatar: "small-meadow-890" -> "SM". */
export function inboxInitials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/** "Today", "Yesterday" or a short date, for the day dividers in a thread. */
export function formatInboxDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function isSameInboxDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
