import { expect, it } from 'vitest';
import { resolveBrilStashProbeMinPrice } from './resolve-probe-min-price';

it.each([
  0, 250_000,
])('defaults the handoff probe to the installation price %d', (price) => {
  expect(resolveBrilStashProbeMinPrice({ handoffMinPrice: price })).toBe(price);
  expect(resolveBrilStashProbeMinPrice({ handoffMinPrice: price }, price)).toBe(
    price
  );
});

it('rejects a mismatched handoff price before probing', () => {
  expect(() =>
    resolveBrilStashProbeMinPrice({ handoffMinPrice: 250_000 }, 0)
  ).toThrow('BrilStash handoff requires minPrice=250000');
  expect(() => resolveBrilStashProbeMinPrice({})).toThrow(
    'BrilStash handoff price unavailable'
  );
});
