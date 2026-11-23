import { describe, expect, it } from 'vitest';
import { formatInboxDay, inboxInitials } from './merchant-inbox-format';
import { buildThreadRows } from './merchant-inbox-rows';

const msg = (id: number, createdAt: string) => ({
  id,
  sender: 'customer' as const,
  kind: 'text' as const,
  text: `m${id}`,
  createdAt,
});

describe('thread rows', () => {
  it('adds one day divider per day, oldest first', () => {
    const now = new Date('2026-11-22T12:00:00');
    const rows = buildThreadRows(
      [
        msg(1, '2026-11-21T09:00:00'),
        msg(2, '2026-11-21T09:05:00'),
        msg(3, '2026-11-22T08:00:00'),
      ],
      now
    );
    expect(rows.map((r) => r.kind)).toEqual([
      'day',
      'message',
      'message',
      'day',
      'message',
    ]);
    expect(rows[0]).toMatchObject({ label: 'Yesterday' });
    expect(rows[3]).toMatchObject({ label: 'Today' });
  });

  it('returns no rows for an empty thread', () => {
    expect(buildThreadRows([])).toEqual([]);
  });

  it('formats avatar initials from visitor and shopper names', () => {
    expect(inboxInitials('small-meadow-890')).toBe('SM');
    expect(inboxInitials('Baci test shopper (ignore)')).toBe('BT');
    expect(inboxInitials('Ada')).toBe('A');
    expect(inboxInitials('123')).toBe('?');
  });

  it('labels days older than yesterday with a date', () => {
    const label = formatInboxDay(
      '2026-11-10T10:00:00',
      new Date('2026-11-22T12:00:00')
    );
    expect(label).toMatch(/10/);
  });
});
