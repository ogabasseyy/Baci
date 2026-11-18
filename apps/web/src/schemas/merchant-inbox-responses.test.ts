import { describe, expect, it } from 'vitest';
import {
  merchantInboxConversationSchema,
  merchantInboxConversationsResponseSchema,
  merchantInboxErrorPayloadSchema,
  merchantInboxMessageSchema,
  merchantInboxReplyResponseSchema,
  merchantInboxThreadResponseSchema,
} from './merchant-inbox';

const message = {
  id: 30,
  sender: 'customer',
  kind: 'text',
  text: 'Hello',
  createdAt: '2026-11-15T06:00:00.000Z',
};
const conversation = {
  id: 7,
  status: 'open',
  unreadCount: 2,
  customerName: 'Synthetic Visitor',
  lastActivityAt: '2026-11-15T06:00:00.000Z',
  lastMessage: message,
};

const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (value: unknown) =>
    schema.safeParse(value).success;

describe('merchantInboxMessageSchema', () => {
  const ok = accepts(merchantInboxMessageSchema);

  it('accepts a valid message', () => {
    expect(ok(message)).toBe(true);
  });

  it.each([
    'customer',
    'store',
    'assistant',
    'system',
  ])('accepts sender %s', (sender) => {
    expect(ok({ ...message, sender })).toBe(true);
  });

  it.each(['text', 'product_card', 'other'])('accepts kind %s', (kind) => {
    expect(ok({ ...message, kind })).toBe(true);
  });

  it('rejects an unknown sender or kind', () => {
    expect(ok({ ...message, sender: 'agent' })).toBe(false);
    expect(ok({ ...message, kind: 'image' })).toBe(false);
  });

  it('bounds text at 4,000 characters and allows it empty', () => {
    expect(ok({ ...message, text: '' })).toBe(true);
    expect(ok({ ...message, text: 'a'.repeat(4_000) })).toBe(true);
    expect(ok({ ...message, text: 'a'.repeat(4_001) })).toBe(false);
  });

  it('bounds createdAt between 1 and 40 characters', () => {
    expect(ok({ ...message, createdAt: '' })).toBe(false);
    expect(ok({ ...message, createdAt: 'a' })).toBe(true);
    expect(ok({ ...message, createdAt: 'a'.repeat(40) })).toBe(true);
    expect(ok({ ...message, createdAt: 'a'.repeat(41) })).toBe(false);
  });

  it('requires a positive safe integer id', () => {
    expect(ok({ ...message, id: 1 })).toBe(true);
    expect(ok({ ...message, id: Number.MAX_SAFE_INTEGER })).toBe(true);
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '30', null]) {
      expect(ok({ ...message, id })).toBe(false);
    }
  });

  it('rejects a missing field', () => {
    const { text: _text, ...withoutText } = message;
    expect(ok(withoutText)).toBe(false);
  });
});

describe('merchantInboxConversationSchema', () => {
  const ok = accepts(merchantInboxConversationSchema);

  it('accepts a valid conversation', () => {
    expect(ok(conversation)).toBe(true);
  });

  it.each([
    'open',
    'resolved',
    'pending',
    'snoozed',
  ])('accepts status %s', (status) => {
    expect(ok({ ...conversation, status })).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(ok({ ...conversation, status: 'archived' })).toBe(false);
  });

  it('accepts null for lastActivityAt and lastMessage', () => {
    expect(ok({ ...conversation, lastActivityAt: null })).toBe(true);
    expect(ok({ ...conversation, lastMessage: null })).toBe(true);
  });

  it('rejects undefined or empty versions of the nullable fields', () => {
    expect(ok({ ...conversation, lastActivityAt: undefined })).toBe(false);
    expect(ok({ ...conversation, lastActivityAt: '' })).toBe(false);
    expect(ok({ ...conversation, lastMessage: undefined })).toBe(false);
  });

  it('bounds lastActivityAt at 40 characters', () => {
    expect(ok({ ...conversation, lastActivityAt: 'a'.repeat(40) })).toBe(true);
    expect(ok({ ...conversation, lastActivityAt: 'a'.repeat(41) })).toBe(false);
  });

  it('bounds customerName between 1 and 80 characters', () => {
    expect(ok({ ...conversation, customerName: '' })).toBe(false);
    expect(ok({ ...conversation, customerName: 'a' })).toBe(true);
    expect(ok({ ...conversation, customerName: 'a'.repeat(80) })).toBe(true);
    expect(ok({ ...conversation, customerName: 'a'.repeat(81) })).toBe(false);
  });

  it('requires unreadCount to be a non-negative integer', () => {
    expect(ok({ ...conversation, unreadCount: 0 })).toBe(true);
    for (const unreadCount of [-1, 1.5, '2', null]) {
      expect(ok({ ...conversation, unreadCount })).toBe(false);
    }
  });

  it('validates the nested last message', () => {
    expect(
      ok({ ...conversation, lastMessage: { ...message, sender: 'agent' } })
    ).toBe(false);
  });
});

describe('merchantInboxConversationsResponseSchema', () => {
  const ok = accepts(merchantInboxConversationsResponseSchema);
  const valid = { conversations: [conversation], hasMore: false, page: 1 };

  it('accepts a valid page, including an empty one', () => {
    expect(ok(valid)).toBe(true);
    expect(ok({ ...valid, conversations: [] })).toBe(true);
  });

  it('allows 200 conversations, the most a server page can hold, and rejects 201', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...conversation,
        id: index + 1,
      }));
    expect(ok({ ...valid, conversations: many(200) })).toBe(true);
    expect(ok({ ...valid, conversations: many(201) })).toBe(false);
  });

  it('requires a boolean hasMore and a positive integer page', () => {
    expect(ok({ ...valid, hasMore: 'no' })).toBe(false);
    expect(ok({ ...valid, page: 1 })).toBe(true);
    for (const page of [0, -1, 1.5, '1']) {
      expect(ok({ ...valid, page })).toBe(false);
    }
  });

  it('rejects an invalid conversation inside the list', () => {
    expect(
      ok({ ...valid, conversations: [{ ...conversation, status: 'x' }] })
    ).toBe(false);
  });
});

describe('merchantInboxThreadResponseSchema', () => {
  const ok = accepts(merchantInboxThreadResponseSchema);
  const valid = { conversation, messages: [message] };

  it('accepts a valid thread, including no messages', () => {
    expect(ok(valid)).toBe(true);
    expect(ok({ ...valid, messages: [] })).toBe(true);
  });

  it('allows 200 messages and rejects 201', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...message,
        id: index + 1,
      }));
    expect(ok({ ...valid, messages: many(200) })).toBe(true);
    expect(ok({ ...valid, messages: many(201) })).toBe(false);
  });

  it('requires a valid conversation and valid messages', () => {
    expect(ok({ messages: [message] })).toBe(false);
    expect(ok({ ...valid, conversation: { ...conversation, id: 0 } })).toBe(
      false
    );
    expect(ok({ ...valid, messages: [{ ...message, kind: 'x' }] })).toBe(false);
  });
});

describe('merchantInboxReplyResponseSchema', () => {
  const ok = accepts(merchantInboxReplyResponseSchema);

  it('accepts a valid reply response', () => {
    expect(ok({ message: { ...message, sender: 'store' } })).toBe(true);
  });

  it('rejects a missing or invalid message', () => {
    expect(ok({})).toBe(false);
    expect(ok({ message: { ...message, sender: 'agent' } })).toBe(false);
    expect(ok({ message: { ...message, text: 'a'.repeat(4_001) } })).toBe(
      false
    );
  });
});

describe('merchantInboxErrorPayloadSchema', () => {
  const ok = accepts(merchantInboxErrorPayloadSchema);

  it('accepts any string code', () => {
    expect(ok({ code: 'unauthorized' })).toBe(true);
    expect(ok({ code: 'something_new', error: 'x' })).toBe(true);
  });

  it.each([
    {},
    { code: 5 },
    { code: null },
    'text',
    null,
  ])('rejects %j', (payload) => {
    expect(ok(payload)).toBe(false);
  });
});
