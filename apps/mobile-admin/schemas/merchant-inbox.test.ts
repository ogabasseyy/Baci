import { describe, expect, it } from 'vitest';
import {
  INBOX_PRESET_TAGS,
  INBOX_VIEWS,
  inboxConversationSchema,
  inboxConversationsResponseSchema,
  inboxCustomerProfileSchema,
  inboxCustomerResponseSchema,
  inboxSearchResponseSchema,
  inboxUpdateResponseSchema,
} from './merchant-inbox';

const message = {
  id: 10,
  sender: 'customer' as const,
  kind: 'text' as const,
  text: 'hi',
  createdAt: '2026-11-22T10:00:00Z',
};

const chat = {
  id: 1,
  status: 'open' as const,
  unreadCount: 2,
  customerName: 'Ada',
  lastActivityAt: '2026-11-22T10:00:00Z',
  lastMessage: message,
};

const order = {
  orderNumber: 'ORD-1',
  total: 50000,
  currency: 'NGN',
  paymentStatus: 'paid',
  shippingStatus: 'shipped',
  createdAt: '2026-11-20T10:00:00Z',
};

const profile = {
  name: 'Ada Obi',
  currency: 'NGN',
  memberSince: null,
  orderCount: 5,
  totalSpent: 412000,
  loyaltyPoints: 120,
  recentOrders: [order],
};

describe('inboxConversationSchema', () => {
  it('accepts a plain chat from an older server with none of the new fields', () => {
    expect(inboxConversationSchema.safeParse(chat).success).toBe(true);
  });

  it('accepts tags, priority, follow-up, snooze time and a customer badge', () => {
    const result = inboxConversationSchema.safeParse({
      ...chat,
      tags: ['lead'],
      priority: 'urgent',
      followUp: true,
      snoozedUntil: '2026-11-23T08:00:00Z',
      customer: { orderCount: 3, totalSpent: 100 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts null for priority, snooze time and customer', () => {
    expect(
      inboxConversationSchema.safeParse({
        ...chat,
        priority: null,
        snoozedUntil: null,
        customer: null,
      }).success
    ).toBe(true);
  });

  it.each([
    ['an unknown priority', { priority: 'critical' }],
    ['an unknown status', { status: 'archived' }],
    ['a negative unread count', { unreadCount: -1 }],
    [
      'a customer badge with negative spend',
      { customer: { orderCount: 1, totalSpent: -1 } },
    ],
    [
      'a customer badge with a fractional count',
      { customer: { orderCount: 1.5, totalSpent: 0 } },
    ],
    ['tags that are not text', { tags: [1, 2] }],
  ])('rejects %s', (_name, change) => {
    expect(
      inboxConversationSchema.safeParse({ ...chat, ...change }).success
    ).toBe(false);
  });
});

describe('inboxCustomerProfileSchema', () => {
  it('accepts a full profile and one with no orders', () => {
    expect(inboxCustomerProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      inboxCustomerProfileSchema.safeParse({
        ...profile,
        orderCount: 0,
        recentOrders: [],
      }).success
    ).toBe(true);
  });

  it('accepts at most five recent orders, as the server sends', () => {
    const order = profile.recentOrders[0];
    const orders = (n: number) => Array.from({ length: n }, () => order);

    expect(
      inboxCustomerProfileSchema.safeParse({
        ...profile,
        recentOrders: orders(5),
      }).success
    ).toBe(true);
    expect(
      inboxCustomerProfileSchema.safeParse({
        ...profile,
        recentOrders: orders(6),
      }).success
    ).toBe(false);
  });

  it('requires a three-letter currency for the store and for each order', () => {
    expect(
      inboxCustomerProfileSchema.safeParse({ ...profile, currency: 'NG' })
        .success
    ).toBe(false);
    expect(
      inboxCustomerProfileSchema.safeParse({ ...profile, currency: 'NGNN' })
        .success
    ).toBe(false);
    expect(
      inboxCustomerProfileSchema.safeParse({
        ...profile,
        recentOrders: [{ ...order, currency: 'naira' }],
      }).success
    ).toBe(false);
    expect(
      inboxCustomerProfileSchema.safeParse({
        ...profile,
        recentOrders: [{ ...order, currency: undefined }],
      }).success
    ).toBe(false);
  });

  it.each([
    ['negative spend', { totalSpent: -1 }],
    ['a fractional order count', { orderCount: 2.5 }],
    ['negative loyalty points', { loyaltyPoints: -3 }],
    ['a missing name', { name: undefined }],
  ])('rejects %s', (_name, change) => {
    expect(
      inboxCustomerProfileSchema.safeParse({ ...profile, ...change }).success
    ).toBe(false);
  });
});

describe('response schemas', () => {
  it('reads the customer answer, with a null customer for a guest chat', () => {
    expect(
      inboxCustomerResponseSchema.parse({ customer: profile }).customer?.name
    ).toBe('Ada Obi');
    expect(
      inboxCustomerResponseSchema.parse({ customer: null }).customer
    ).toBeNull();
    expect(inboxCustomerResponseSchema.safeParse({}).success).toBe(false);
  });

  it('reads an update answer', () => {
    expect(
      inboxUpdateResponseSchema.safeParse({ conversation: chat }).success
    ).toBe(true);
    expect(
      inboxUpdateResponseSchema.safeParse({ conversation: { id: 1 } }).success
    ).toBe(false);
  });

  it('reads search results with a snippet or a null snippet', () => {
    const ok = inboxSearchResponseSchema.safeParse({
      results: [
        { conversation: chat, snippet: 'where is my order' },
        { conversation: { ...chat, id: 2 }, snippet: null },
      ],
      hasMore: false,
      page: 1,
    });
    expect(ok.success).toBe(true);
    expect(
      inboxSearchResponseSchema.safeParse({
        results: [],
        hasMore: true,
        page: 0,
      }).success
    ).toBe(false);
    expect(
      inboxSearchResponseSchema.safeParse({
        results: [{ conversation: chat }],
        hasMore: false,
        page: 1,
      }).success
    ).toBe(false);
  });

  it('reads a conversations page', () => {
    expect(
      inboxConversationsResponseSchema.safeParse({
        conversations: [chat],
        hasMore: true,
        page: 2,
      }).success
    ).toBe(true);
  });
});

describe('constants', () => {
  it('lists the views in the order the chips show them, with Customers included', () => {
    expect(INBOX_VIEWS.map((v) => v.value)).toEqual([
      'needs_reply',
      'unread',
      'follow_up',
      'returning',
      'done',
      'all',
    ]);
  });

  it('offers five quick tags', () => {
    expect(INBOX_PRESET_TAGS).toHaveLength(5);
  });
});

describe('order-data permission flag', () => {
  it('accepts ordersHidden on a customer badge and profile, and rejects a non-boolean', () => {
    expect(
      inboxConversationSchema.safeParse({
        ...chat,
        customer: { orderCount: 0, totalSpent: 0, ordersHidden: true },
      }).success
    ).toBe(true);
    expect(
      inboxCustomerProfileSchema.safeParse({ ...profile, ordersHidden: true })
        .success
    ).toBe(true);
    expect(
      inboxCustomerProfileSchema.safeParse({ ...profile, ordersHidden: 'yes' })
        .success
    ).toBe(false);
  });
});
