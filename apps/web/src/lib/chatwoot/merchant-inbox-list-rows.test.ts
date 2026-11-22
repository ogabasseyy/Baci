import { describe, expect, it } from 'vitest';
import { buildMerchantInboxListRows } from './merchant-inbox-list-rows';

const row = (
  id: number,
  overrides: Record<string, unknown> = {},
  inboxId = 20
) => ({
  id,
  inbox_id: inboxId,
  status: 'open',
  last_activity_at: 1_794_720_000 + id,
  meta: { sender: { name: `Shopper ${id}` } },
  ...overrides,
});

const withLink = (id: number, token: string) =>
  row(id, {
    meta: {
      sender: {
        name: `Shopper ${id}`,
        custom_attributes: { baci_customer_link: token },
      },
    },
  });

describe('buildMerchantInboxListRows', () => {
  it('keeps only chats of the bound inbox, newest activity first', () => {
    const { conversations } = buildMerchantInboxListRows(
      [row(1), row(3), row(9, {}, 99), row(2)],
      20
    );
    expect(conversations.map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it('returns signed links beside the rows and never inside them', () => {
    const { conversations, links } = buildMerchantInboxListRows(
      [withLink(1, 'signed.one'), row(2)],
      20
    );
    expect(links).toEqual({ 1: 'signed.one' });
    expect(JSON.stringify(conversations)).not.toContain('signed.one');
  });

  it('gives no link for a chat dropped from another inbox', () => {
    const { links } = buildMerchantInboxListRows(
      [{ ...withLink(5, 'signed.other'), inbox_id: 99 }],
      20
    );
    expect(links).toEqual({});
  });

  it('applies the view rule to every row', () => {
    const { conversations } = buildMerchantInboxListRows(
      [row(1, { status: 'resolved' }), row(2, { status: 'open' })],
      20,
      'done'
    );
    expect(conversations.map((c) => c.id)).toEqual([1]);
  });

  it('skips rows it cannot read without failing the page', () => {
    const { conversations } = buildMerchantInboxListRows(
      [row(1), { nope: true }, null, 'text'],
      20
    );
    expect(conversations.map((c) => c.id)).toEqual([1]);
  });

  it('returns nothing for an empty page', () => {
    expect(buildMerchantInboxListRows([], 20)).toEqual({
      conversations: [],
      links: {},
    });
  });
});
