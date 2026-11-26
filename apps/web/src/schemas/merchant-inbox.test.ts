import { CHAT_REPLY_MAX_LENGTH } from '@baci/shared';
import { describe, expect, it } from 'vitest';
import {
  MERCHANT_INBOX_MAX_CONVERSATIONS_PER_PAGE,
  MERCHANT_INBOX_REPLY_MAX_LENGTH,
  merchantInboxConversationIdSchema,
  merchantInboxListQuerySchema,
  merchantInboxMessagesQuerySchema,
  providerInboxConversationListSchema,
} from './merchant-inbox';

describe('merchantInboxListQuerySchema', () => {
  it('defaults to page 1 and all statuses', () => {
    expect(merchantInboxListQuerySchema.parse({})).toEqual({
      page: 1,
      status: 'all',
    });
  });

  it('accepts every status including snoozed', () => {
    for (const status of ['open', 'resolved', 'pending', 'snoozed', 'all']) {
      expect(merchantInboxListQuerySchema.parse({ status }).status).toBe(
        status
      );
    }
    expect(
      merchantInboxListQuerySchema.safeParse({ status: 'x' }).success
    ).toBe(false);
  });

  it('bounds page between 1 and 500', () => {
    expect(merchantInboxListQuerySchema.parse({ page: '500' }).page).toBe(500);
    for (const page of ['0', '501', '-1', '1.5', 'abc']) {
      expect(merchantInboxListQuerySchema.safeParse({ page }).success).toBe(
        false
      );
    }
  });
});

describe('merchantInboxMessagesQuerySchema', () => {
  it('treats before as optional and coerces a positive integer', () => {
    expect(merchantInboxMessagesQuerySchema.parse({})).toEqual({});
    expect(merchantInboxMessagesQuerySchema.parse({ before: '42' })).toEqual({
      before: 42,
    });
  });

  it('rejects non-positive or non-integer cursors', () => {
    for (const before of ['0', '-4', '1.5', 'abc']) {
      expect(
        merchantInboxMessagesQuerySchema.safeParse({ before }).success
      ).toBe(false);
    }
  });
});

describe('merchantInboxConversationIdSchema', () => {
  it('coerces a positive integer id', () => {
    expect(merchantInboxConversationIdSchema.parse('7')).toBe(7);
  });

  it('rejects abc, zero, negatives and floats', () => {
    for (const id of ['abc', '0', '-4', '1.5']) {
      expect(merchantInboxConversationIdSchema.safeParse(id).success).toBe(
        false
      );
    }
  });
});

describe('providerInboxConversationListSchema', () => {
  const page = (count: number) => ({
    data: { payload: Array.from({ length: count }, () => ({})) },
  });

  it('accepts a full provider page and rejects one row over it', () => {
    expect(MERCHANT_INBOX_MAX_CONVERSATIONS_PER_PAGE).toBe(200);
    expect(
      providerInboxConversationListSchema.safeParse(page(200)).success
    ).toBe(true);
    expect(
      providerInboxConversationListSchema.safeParse(page(201)).success
    ).toBe(false);
  });
});

describe('MERCHANT_INBOX_REPLY_MAX_LENGTH', () => {
  it('is the one reply length limit the app and the server share', () => {
    expect(MERCHANT_INBOX_REPLY_MAX_LENGTH).toBe(CHAT_REPLY_MAX_LENGTH);
  });
});
