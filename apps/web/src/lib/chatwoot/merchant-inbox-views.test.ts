import { describe, expect, it } from 'vitest';
import type { MerchantInboxConversation } from '@/schemas/merchant-inbox';
import { matchesView, providerQueryForView } from './merchant-inbox-views';

const base: MerchantInboxConversation = {
  id: 1,
  status: 'open',
  unreadCount: 0,
  customerName: 'Ada',
  lastActivityAt: null,
  lastMessage: null,
};
const fromCustomer = {
  id: 9,
  sender: 'customer' as const,
  kind: 'text' as const,
  text: 'hi',
  createdAt: '2026-11-22T10:00:00.000Z',
};

describe('matchesView', () => {
  it('needs_reply keeps live chats whose last message is the shopper', () => {
    expect(
      matchesView({ ...base, lastMessage: fromCustomer }, 'needs_reply')
    ).toBe(true);
    expect(
      matchesView(
        { ...base, lastMessage: { ...fromCustomer, sender: 'store' } },
        'needs_reply'
      )
    ).toBe(false);
  });

  it('needs_reply leaves out resolved and follow-up (snoozed) chats', () => {
    expect(
      matchesView(
        { ...base, status: 'resolved', lastMessage: fromCustomer },
        'needs_reply'
      )
    ).toBe(false);
    expect(
      matchesView(
        { ...base, status: 'snoozed', lastMessage: fromCustomer },
        'needs_reply'
      )
    ).toBe(false);
  });

  it('unread needs a count and is never a resolved chat', () => {
    expect(matchesView({ ...base, unreadCount: 2 }, 'unread')).toBe(true);
    expect(
      matchesView({ ...base, unreadCount: 2, status: 'resolved' }, 'unread')
    ).toBe(false);
    expect(matchesView(base, 'unread')).toBe(false);
  });

  it('follow_up needs the follow-up marker and an unresolved chat', () => {
    expect(matchesView({ ...base, followUp: true }, 'follow_up')).toBe(true);
    expect(
      matchesView({ ...base, followUp: true, status: 'resolved' }, 'follow_up')
    ).toBe(false);
    expect(matchesView(base, 'follow_up')).toBe(false);
  });

  it('returning leaves out finished chats and waits for the customer check', () => {
    expect(matchesView(base, 'returning')).toBe(true);
    expect(matchesView({ ...base, status: 'resolved' }, 'returning')).toBe(
      false
    );
  });

  it('done is exactly the resolved chats', () => {
    expect(matchesView({ ...base, status: 'resolved' }, 'done')).toBe(true);
    expect(matchesView(base, 'done')).toBe(false);
  });
});

describe('providerQueryForView', () => {
  it('asks the provider for resolved chats only for done', () => {
    expect(providerQueryForView('done')).toEqual({ status: 'resolved' });
  });

  it('filters follow-up by label', () => {
    expect(providerQueryForView('follow_up')).toEqual({
      status: 'all',
      labels: ['follow-up'],
    });
  });

  it('reads everything for the other views', () => {
    expect(providerQueryForView('needs_reply')).toEqual({ status: 'all' });
  });
});
