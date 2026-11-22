import { describe, expect, it } from 'vitest';
import {
  INBOX_MAX_FOLLOW_UP_DAYS,
  INBOX_PRIORITIES,
  INBOX_SNIPPET_MAX_LENGTH,
  merchantInboxSearchQuerySchema,
  merchantInboxUpdateSchema,
} from './merchant-inbox-manage';

const parse = (value: unknown) => merchantInboxUpdateSchema.safeParse(value);

describe('merchantInboxUpdateSchema', () => {
  it.each([
    ['marking a chat Done', { status: 'resolved' }],
    ['reopening a chat', { status: 'open' }],
    ['a follow-up time', { followUpAt: '2026-11-23T08:00:00.000Z' }],
    ['clearing a follow-up', { followUpAt: null }],
    ['setting a priority', { priority: 'urgent' }],
    ['clearing the priority', { priority: null }],
    ['adding and removing tags', { addTags: ['Payment'], removeTags: ['old'] }],
  ])('accepts %s', (_name, body) => {
    expect(parse(body).success).toBe(true);
  });

  it('accepts every priority the app offers', () => {
    for (const priority of INBOX_PRIORITIES) {
      expect(parse({ priority }).success).toBe(true);
    }
  });

  it('turns typed tag names into label-safe slugs', () => {
    expect(parse({ addTags: ['  Order Issue ', 'Prix élevé!'] })).toMatchObject(
      {
        success: true,
        data: { addTags: ['order-issue', 'prix-élevé'] },
      }
    );
  });

  it.each([
    ['an empty change', {}],
    [
      'an unknown key (tenant or customer ids)',
      { status: 'open', merchantId: 'x' },
    ],
    ['a bad status', { status: 'deleted' }],
    ['a bad priority', { priority: 'critical' }],
    ['a follow-up that is not an ISO time', { followUpAt: '2026-11-23' }],
    ['a follow-up that is not text', { followUpAt: 12345 }],
    [
      'a finished chat with a follow-up',
      {
        status: 'resolved',
        followUpAt: '2026-11-23T08:00:00.000Z',
      },
    ],
    ['a tag with nothing usable in it', { addTags: ['!!!'] }],
    ['an empty tag', { addTags: [''] }],
    ['a tag over 30 characters', { addTags: ['x'.repeat(31)] }],
    ['six new tags at once', { addTags: ['a', 'b', 'c', 'd', 'e', 'f'] }],
    [
      'eleven removals at once',
      {
        removeTags: Array.from({ length: 11 }, (_, i) => `t${i}`),
      },
    ],
  ])('rejects %s', (_name, body) => {
    expect(parse(body).success).toBe(false);
  });

  it('allows a finished chat with the follow-up explicitly cleared', () => {
    expect(parse({ status: 'resolved', followUpAt: null }).success).toBe(true);
  });

  it('allows five new tags and ten removals, the limits', () => {
    expect(parse({ addTags: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(true);
    expect(
      parse({ removeTags: Array.from({ length: 10 }, (_, i) => `t${i}`) })
        .success
    ).toBe(true);
  });

  it('accepts a tag of exactly 30 characters', () => {
    expect(parse({ addTags: ['x'.repeat(30)] }).success).toBe(true);
  });
});

describe('merchantInboxSearchQuerySchema', () => {
  it('trims the term and defaults to the first page', () => {
    expect(merchantInboxSearchQuerySchema.parse({ q: '  order ' })).toEqual({
      q: 'order',
      page: 1,
    });
  });

  it('reads the page from text, as a query string gives it', () => {
    expect(
      merchantInboxSearchQuerySchema.parse({ q: 'ok', page: '3' }).page
    ).toBe(3);
  });

  it('accepts a 2-character and a 100-character term', () => {
    expect(merchantInboxSearchQuerySchema.safeParse({ q: 'ab' }).success).toBe(
      true
    );
    expect(
      merchantInboxSearchQuerySchema.safeParse({ q: 'x'.repeat(100) }).success
    ).toBe(true);
  });

  it.each([
    ['a missing term', {}],
    ['a 1-character term', { q: 'a' }],
    ['a blank term', { q: '   ' }],
    ['a 101-character term', { q: 'x'.repeat(101) }],
    ['page 0', { q: 'ok', page: '0' }],
    ['page 51', { q: 'ok', page: '51' }],
    ['a non-number page', { q: 'ok', page: 'abc' }],
    ['a fractional page', { q: 'ok', page: '1.5' }],
  ])('rejects %s', (_name, value) => {
    expect(merchantInboxSearchQuerySchema.safeParse(value).success).toBe(false);
  });

  it('exposes the limits other code relies on', () => {
    expect(INBOX_MAX_FOLLOW_UP_DAYS).toBe(90);
    expect(INBOX_SNIPPET_MAX_LENGTH).toBe(140);
  });
});
