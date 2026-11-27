import { describe, expect, it, vi } from 'vitest';
import type { InboxConversation } from '@/schemas/merchant-inbox';
import { isFollowUpDue, sortInbox } from './merchant-inbox-sort';

const chat = (
  id: number,
  overrides: Partial<InboxConversation> = {}
): InboxConversation => ({
  id,
  status: 'open',
  unreadCount: 0,
  customerName: `Shopper ${id}`,
  lastActivityAt: `2026-11-22T0${id}:00:00.000Z`,
  lastMessage: {
    id: id * 10,
    sender: 'customer',
    kind: 'text',
    text: 'hi',
    createdAt: `2026-11-22T0${id}:00:00.000Z`,
  },
  ...overrides,
});

const ids = (list: InboxConversation[]) => list.map((c) => c.id);

describe('sortInbox', () => {
  it('puts the longest-waiting chat first on Needs reply', () => {
    expect(ids(sortInbox([chat(3), chat(1), chat(2)], 'needs_reply'))).toEqual([
      1, 2, 3,
    ]);
  });

  it('lets priority beat waiting time', () => {
    const sorted = sortInbox(
      [chat(1), chat(2, { priority: 'high' }), chat(3, { priority: 'urgent' })],
      'needs_reply'
    );
    expect(ids(sorted)).toEqual([3, 2, 1]);
  });

  it('keeps the other views newest first', () => {
    expect(ids(sortInbox([chat(1), chat(3), chat(2)], 'all'))).toEqual([
      3, 2, 1,
    ]);
  });

  it('shows due follow-ups before ones still snoozed, soonest first', () => {
    // Both snooze times are still ahead.
    vi.useFakeTimers({ now: new Date('2026-11-22T12:00:00.000Z') });
    const sorted = sortInbox(
      [
        chat(1, {
          followUp: true,
          status: 'snoozed',
          snoozedUntil: '2026-11-25T08:00:00.000Z',
        }),
        chat(2, {
          followUp: true,
          status: 'snoozed',
          snoozedUntil: '2026-11-23T08:00:00.000Z',
        }),
        chat(3, { followUp: true, status: 'open' }),
      ],
      'follow_up'
    );
    vi.useRealTimers();
    expect(ids(sorted)).toEqual([3, 2, 1]);
  });

  it('does not change the input array', () => {
    const input = [chat(2), chat(1)];
    sortInbox(input, 'needs_reply');
    expect(ids(input)).toEqual([2, 1]);
  });
});

describe('sortInbox for views that are not ranked across pages', () => {
  it('bugfix: keeps Done and All newest first and ignores priority', () => {
    const list = [
      chat(1, { priority: 'urgent' }),
      chat(3),
      chat(2, { priority: 'high' }),
    ];
    expect(ids(sortInbox(list, 'all'))).toEqual([3, 2, 1]);
    expect(ids(sortInbox(list, 'done'))).toEqual([3, 2, 1]);
  });

  it('still ranks by priority on the views that load several pages', () => {
    const list = [chat(1, { priority: 'urgent' }), chat(3), chat(2)];
    for (const view of ['needs_reply', 'unread', 'follow_up'] as const) {
      expect(ids(sortInbox(list, view))[0]).toBe(1);
    }
  });
});

describe('isFollowUpDue', () => {
  it('is true only for a marked chat that is back in the open queue', () => {
    expect(isFollowUpDue(chat(1, { followUp: true }))).toBe(true);
    expect(isFollowUpDue(chat(1, { followUp: true, status: 'snoozed' }))).toBe(
      false
    );
    expect(isFollowUpDue(chat(1, { followUp: true, status: 'resolved' }))).toBe(
      false
    );
    expect(isFollowUpDue(chat(1))).toBe(false);
  });

  it('bugfix: is due once the snooze time passes, before the chat reopens', () => {
    // The chat engine reopens a snoozed chat a little after its time.
    const now = new Date('2026-11-25T12:00:00.000Z');
    const snoozed = (snoozedUntil: string) =>
      chat(1, { followUp: true, status: 'snoozed', snoozedUntil });

    expect(isFollowUpDue(snoozed('2026-11-25T11:59:00.000Z'), now)).toBe(true);
    expect(isFollowUpDue(snoozed('2026-11-25T12:00:00.000Z'), now)).toBe(true);
    expect(isFollowUpDue(snoozed('2026-11-25T12:01:00.000Z'), now)).toBe(false);
  });
});

describe('sortInbox with customers', () => {
  const returning = { orderCount: 3, totalSpent: 150000 };

  it('puts returning customers before guests of the same priority', () => {
    const sorted = sortInbox(
      [chat(1), chat(2, { customer: returning }), chat(3)],
      'needs_reply'
    );
    expect(ids(sorted)).toEqual([2, 1, 3]);
  });

  it('still lets an explicit priority beat a returning customer', () => {
    const sorted = sortInbox(
      [chat(1, { customer: returning }), chat(2, { priority: 'urgent' })],
      'needs_reply'
    );
    expect(ids(sorted)).toEqual([2, 1]);
  });

  it('does not treat a signed-in customer with no orders as returning', () => {
    const sorted = sortInbox(
      [chat(1), chat(2, { customer: { orderCount: 0, totalSpent: 0 } })],
      'needs_reply'
    );
    expect(ids(sorted)).toEqual([1, 2]);
  });
});

describe('sortInbox with hidden order data', () => {
  it('does not treat a customer whose orders are hidden as returning', () => {
    const sorted = sortInbox(
      [
        chat(1),
        chat(2, {
          customer: { orderCount: 9, totalSpent: 5, ordersHidden: true },
        }),
      ],
      'needs_reply'
    );
    // Same priority, no returning boost for either: longest waiting first.
    expect(ids(sorted)).toEqual([1, 2]);
  });
});
