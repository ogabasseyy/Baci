import { describe, expect, it } from 'vitest';
import {
  INBOX_PRESET_TAGS,
  INBOX_VIEWS,
  inboxConversationSchema,
  inboxConversationsResponseSchema,
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

describe('inboxConversationSchema', () => {
  it('accepts a plain chat from an older server with none of the new fields', () => {
    expect(inboxConversationSchema.safeParse(chat).success).toBe(true);
  });

  it('accepts tags, priority, follow-up and a snooze time', () => {
    expect(
      inboxConversationSchema.safeParse({
        ...chat,
        tags: ['lead'],
        priority: 'urgent',
        followUp: true,
        snoozedUntil: '2026-11-23T08:00:00Z',
      }).success
    ).toBe(true);
  });

  it('accepts null for priority and snooze time, and a chat with no messages', () => {
    expect(
      inboxConversationSchema.safeParse({
        ...chat,
        lastMessage: null,
        lastActivityAt: null,
        priority: null,
        snoozedUntil: null,
      }).success
    ).toBe(true);
  });

  it.each([
    ['an unknown priority', { priority: 'critical' }],
    ['an unknown status', { status: 'archived' }],
    ['a negative unread count', { unreadCount: -1 }],
    ['a fractional unread count', { unreadCount: 1.5 }],
    ['a zero id', { id: 0 }],
    ['tags that are not text', { tags: [1, 2] }],
    ['a follow-up that is not true or false', { followUp: 'yes' }],
    ['a malformed last message', { lastMessage: { id: 1 } }],
  ])('rejects %s', (_name, change) => {
    expect(
      inboxConversationSchema.safeParse({ ...chat, ...change }).success
    ).toBe(false);
  });
});

describe('response schemas', () => {
  it('reads an update answer and refuses a malformed one', () => {
    expect(
      inboxUpdateResponseSchema.safeParse({ conversation: chat }).success
    ).toBe(true);
    expect(
      inboxUpdateResponseSchema.safeParse({ conversation: { id: 1 } }).success
    ).toBe(false);
    expect(inboxUpdateResponseSchema.safeParse({}).success).toBe(false);
  });

  it('reads search results with a snippet or a null snippet', () => {
    expect(
      inboxSearchResponseSchema.safeParse({
        results: [
          { conversation: chat, snippet: 'where is my order' },
          { conversation: { ...chat, id: 2 }, snippet: null },
        ],
        hasMore: false,
        page: 1,
      }).success
    ).toBe(true);
  });

  it.each([
    ['page 0', { results: [], hasMore: true, page: 0 }],
    ['a fractional page', { results: [], hasMore: true, page: 1.5 }],
    ['a missing hasMore', { results: [], page: 1 }],
    [
      'a hit with no snippet field',
      { results: [{ conversation: chat }], hasMore: false, page: 1 },
    ],
    [
      'a hit with a malformed chat',
      {
        results: [{ conversation: { id: 1 }, snippet: null }],
        hasMore: false,
        page: 1,
      },
    ],
    [
      'results that are not a list',
      { results: 'none', hasMore: false, page: 1 },
    ],
  ])('rejects a search answer with %s', (_name, value) => {
    expect(inboxSearchResponseSchema.safeParse(value).success).toBe(false);
  });

  it('reads a conversations page and refuses a page 0', () => {
    expect(
      inboxConversationsResponseSchema.safeParse({
        conversations: [chat],
        hasMore: true,
        page: 2,
      }).success
    ).toBe(true);
    expect(
      inboxConversationsResponseSchema.safeParse({
        conversations: [],
        hasMore: false,
        page: 0,
      }).success
    ).toBe(false);
  });
});

describe('constants', () => {
  it('lists the views in the order the chips show them', () => {
    expect(INBOX_VIEWS.map((v) => v.value)).toEqual([
      'needs_reply',
      'unread',
      'follow_up',
      'done',
      'all',
    ]);
  });

  it('offers five quick tags', () => {
    expect(INBOX_PRESET_TAGS).toHaveLength(5);
  });
});
