import type { InboxMessage } from '@/schemas/merchant-inbox';
import { formatInboxDay, isSameInboxDay } from './merchant-inbox-format';

export type ThreadRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: InboxMessage };

/** Oldest-first messages with a day divider before each new day. */
export function buildThreadRows(
  messages: InboxMessage[],
  now: Date = new Date()
): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let previous: InboxMessage | undefined;
  for (const message of messages) {
    if (!previous || !isSameInboxDay(previous.createdAt, message.createdAt)) {
      rows.push({
        kind: 'day',
        key: `day-${message.id}`,
        label: formatInboxDay(message.createdAt, now),
      });
    }
    rows.push({ kind: 'message', key: `m-${message.id}`, message });
    previous = message;
  }
  return rows;
}
