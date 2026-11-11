import type { CartItem } from '@/stores/cart-store.types';
import { sameServerLine } from './same-server-line';

const P = '33333333-3333-4333-8333-333333333333';
const hydrated: CartItem = {
  id: 'l1',
  product_id: P,
  slug: 'p',
  name: 'P',
  price: 1,
  quantity: 1,
  variant_attributes: { size: 'M' },
};
const { id: _id, ...added } = hydrated;

it('matches the same product and options regardless of display-only fields', () => {
  expect(sameServerLine(hydrated, { ...added, offer_id: 'offer-1' })).toBe(
    true
  );
});

it('separates lines that differ in any option, not just color or storage', () => {
  expect(
    sameServerLine(hydrated, { ...added, variant_attributes: { size: 'L' } })
  ).toBe(false);
});

it('separates voucher lines from plain ones', () => {
  expect(sameServerLine(hydrated, { ...added, voucher_token: 't' })).toBe(
    false
  );
});

it('treats an unusable condition as not the same line', () => {
  expect(sameServerLine(hydrated, { ...added, condition: 'broken' })).toBe(
    false
  );
});
