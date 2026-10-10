import { expect, it } from 'vitest';
import {
  buildReviewCartUrl,
  hasReviewableHandoffLines,
} from './review-cart-url';
const line = JSON.stringify([
  { product_id: '11111111-1111-4111-8111-111111111111', quantity: 2 },
]);
it('keeps the idempotent guest-cart payload on review', () => {
  const stored = `https://ogabassey.com/cart?guest_cart=${encodeURIComponent(line)}`;
  expect(buildReviewCartUrl(stored)).toBe(stored);
});
it('opens the bare cart when the payload is malformed or one-shot', () => {
  expect(buildReviewCartUrl('https://ogabassey.com/cart?guest_cart=[]')).toBe(
    'https://ogabassey.com/cart'
  );
  expect(buildReviewCartUrl('https://ogabassey.com/cart?guest_cart=%%')).toBe(
    'https://ogabassey.com/cart'
  );
  expect(
    buildReviewCartUrl('https://ogabassey.com/cart?item_id=abc&qty=1')
  ).toBe('https://ogabassey.com/cart');
});
it('refuses hostile stored cart links', () => {
  expect(buildReviewCartUrl('https://evil.example/cart')).toBeNull();
  expect(
    buildReviewCartUrl('https://ogabassey.com/cart?guest_cart=x')
  ).not.toBeNull();
  expect(buildReviewCartUrl('https://ogabassey.com/checkout')).toBeNull();
  expect(
    buildReviewCartUrl('https://user:pass@ogabassey.com/cart')
  ).toBeNull();
});
it('detects a handoff URL that still carries lines', () => {
  expect(
    hasReviewableHandoffLines(
      `https://ogabassey.com/cart?guest_cart=${encodeURIComponent(line)}`
    )
  ).toBe(true);
});
it('rejects empty, malformed, and hostile handoff URLs', () => {
  expect(hasReviewableHandoffLines(undefined)).toBe(false);
  expect(hasReviewableHandoffLines('https://ogabassey.com/cart')).toBe(false);
  expect(
    hasReviewableHandoffLines('https://ogabassey.com/cart?guest_cart=[]')
  ).toBe(false);
  expect(
    hasReviewableHandoffLines('https://ogabassey.com/cart?guest_cart=%%')
  ).toBe(false);
  expect(hasReviewableHandoffLines('https://evil.example/cart')).toBe(false);
  expect(hasReviewableHandoffLines('notaurl')).toBe(false);
});
