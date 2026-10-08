import { describe, expect, it } from 'vitest';
import { rewriteCartLinkUrl } from './rewrite-cart-link-url';

const line = {
  product_id: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
};

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

  it('drops rejected lines missing a handoff quantity', () => {
    const rewritten = rewriteCartLinkUrl(
      `${base}&guest_cart=%5B%5D`,
      quantities,
      [line.product_id, '99999999-9999-4999-8999-999999999999']
    );
    const url = new URL(rewritten, 'https://ogabassey.com');
    expect(JSON.parse(url.searchParams.get('guest_cart') ?? '[]')).toEqual([
      { product_id: line.product_id, quantity: line.quantity },
    ]);
  });

  it('clears a dead guest_cart when the transfer did not originate from it', () => {
    const retry = new URL(
      rewriteCartLinkUrl(
        'https://ogabassey.com/cart?guest_cart=dead&item_id=a',
        undefined,
        ['b']
      ),
      'https://ogabassey.com'
    );
    expect(retry.searchParams.get('item_id')).toBe('b');
    expect(retry.searchParams.has('guest_cart')).toBe(false);
    const done = new URL(
      rewriteCartLinkUrl(
        'https://ogabassey.com/cart?guest_cart=dead&item_id=a',
        undefined,
        []
      ),
      'https://ogabassey.com'
    );
    expect(done.search).toBe('');
  });

  it('deletes guest_cart when no rejected line has a quantity', () => {
    const retry = new URL(
      rewriteCartLinkUrl(
        'https://ogabassey.com/cart?guest_cart=old',
        new Map(),
        ['a']
      ),
      'https://ogabassey.com'
    );
    expect(retry.searchParams.has('guest_cart')).toBe(false);
  });
});
