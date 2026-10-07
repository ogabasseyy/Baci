import { describe, expect, it } from 'vitest';
import {
  parseGuestCartHandoff,
  resolveGuestCartTransfer,
  resolveGuestQuantityToAdd,
  rewriteCartLinkUrl,
} from './guest-cart-handoff';

const line = {
  product_id: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
};
it('retains per-product quantities without accepting client prices', () => {
  expect(
    parseGuestCartHandoff(JSON.stringify([{ ...line, price: 1 }]))
  ).toEqual([line]);
});
it('rejects malformed, duplicate, oversized, fractional and excessive handoffs', () => {
  for (const raw of [
    'bad',
    JSON.stringify([line, line]),
    'x'.repeat(4001),
    JSON.stringify([{ ...line, quantity: 1.5 }]),
    JSON.stringify([{ ...line, quantity: 11 }]),
  ])
    expect(parseGuestCartHandoff(raw)).toBeNull();
});

describe('resolveGuestCartTransfer', () => {
  it('returns item ids and per-product quantities', () => {
    const second = {
      product_id: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
    };
    expect(resolveGuestCartTransfer(JSON.stringify([line, second]))).toEqual({
      itemIds: `${line.product_id},${second.product_id}`,
      quantities: new Map([
        [line.product_id, line.quantity],
        [second.product_id, second.quantity],
      ]),
    });
  });

  it('returns null for missing or invalid handoffs', () => {
    expect(resolveGuestCartTransfer(null)).toBeNull();
    expect(resolveGuestCartTransfer('bad')).toBeNull();
  });
});

describe('resolveGuestQuantityToAdd', () => {
  it('falls back to the link quantity without a handoff target', () => {
    expect(resolveGuestQuantityToAdd(undefined, 2, 3)).toBe(3);
  });

  it('tops up to the handoff target without overshooting', () => {
    expect(resolveGuestQuantityToAdd(5, 2, 1)).toBe(3);
  });

  it('never shrinks an already-transferred line', () => {
    expect(resolveGuestQuantityToAdd(2, 5, 1)).toBe(0);
    expect(resolveGuestQuantityToAdd(2, 2, 1)).toBe(0);
  });
});

describe('rewriteCartLinkUrl', () => {
  const quantities = new Map([[line.product_id, line.quantity]]);
  const base = 'https://ogabassey.com/cart?quiz_award_id=a';

  it('keeps only retryable guest lines in the handoff', () => {
    const rewritten = rewriteCartLinkUrl(
      `${base}&guest_cart=%5B%5D&item_id=x&qty=2#top`,
      quantities,
      [line.product_id]
    );
    const url = new URL(rewritten, 'https://ogabassey.com');
    expect(JSON.parse(url.searchParams.get('guest_cart') ?? '[]')).toEqual([
      { product_id: line.product_id, quantity: line.quantity },
    ]);
    expect(url.searchParams.has('item_id')).toBe(false);
    expect(url.searchParams.has('qty')).toBe(false);
    expect(url.searchParams.has('quiz_award_id')).toBe(false);
    expect(url.hash).toBe('#top');
  });

  it('consumes the guest handoff once fully transferred', () => {
    const rewritten = rewriteCartLinkUrl(
      `${base}&guest_cart=%5B%5D&item_id=x&qty=2`,
      quantities,
      []
    );
    const url = new URL(rewritten, 'https://ogabassey.com');
    expect(url.searchParams.has('guest_cart')).toBe(false);
    expect(url.searchParams.has('item_id')).toBe(false);
    expect(url.searchParams.has('qty')).toBe(false);
  });

  it('rewrites plain item links without guest state', () => {
    expect(
      rewriteCartLinkUrl('https://ogabassey.com/cart?item_id=a', undefined, [
        'b',
      ])
    ).toBe('/cart?item_id=b');
    expect(
      rewriteCartLinkUrl(
        'https://ogabassey.com/cart?item_id=a&qty=2',
        undefined,
        []
      )
    ).toBe('/cart');
  });
});
