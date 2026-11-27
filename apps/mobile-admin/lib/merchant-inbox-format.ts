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

/** The chat engine's made-up visitor names look like "small-meadow-890". */
const VISITOR_SLUG = /^[a-z]+(?:-[a-z]+)+-\d+$/;

/**
 * What a chat is called on screen. A visitor's made-up slug reads as a
 * machine id, so "small-meadow-890" becomes "Small Meadow"; a real name is
 * shown as it is, and a blank one is "Visitor".
 */
export function inboxDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Visitor';
  if (!VISITOR_SLUG.test(trimmed)) return trimmed;
  return trimmed
    .split('-')
    .slice(0, -1)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
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

/** The follow-up line on a row: "Follow up due" or "Follow up Tue 9:00 AM". */
export function formatFollowUp(
  snoozedUntil: string | null | undefined,
  due: boolean,
  now: Date = new Date()
): string {
  if (due) return 'Follow up due';
  if (!snoozedUntil) return 'Follow up';
  const at = new Date(snoozedUntil);
  if (Number.isNaN(at.getTime())) return 'Follow up';
  const day = formatInboxDay(snoozedUntil, now);
  const time = at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const dayLabel =
    day === 'Today' || day === 'Yesterday'
      ? day
      : at.toLocaleDateString(undefined, { weekday: 'short' });
  return `Follow up ${dayLabel} ${time}`;
}

/** "order-issue" -> "Order issue". */
export function formatInboxTag(slug: string): string {
  const text = slug.replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : slug;
}

/** Follow-up choices as ISO times, from `now`. Morning = 9:00 local. */
export function followUpOptions(
  now: Date = new Date()
): { label: string; iso: string }[] {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const laterToday = new Date(now.getTime() + 3 * 3_600_000);
  const options = [
    { label: 'In 3 hours', date: laterToday },
    { label: 'Tomorrow morning', date: at(1, 9) },
    { label: 'In 3 days', date: at(3, 9) },
    { label: 'Next week', date: at(7, 9) },
  ];
  return options
    .filter((option) => option.date.getTime() > now.getTime())
    .map((option) => ({
      label: option.label,
      iso: option.date.toISOString(),
    }));
}

/** "1 order" or "5 orders". */
export function formatOrderCount(count: number): string {
  return `${count} ${count === 1 ? 'order' : 'orders'}`;
}
