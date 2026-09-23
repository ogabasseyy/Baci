import { expect, it } from 'vitest';
import { createStorefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-store';

it('expires failures and evicts the oldest scope at capacity', () => {
  const store = createStorefrontPdpSemanticReadCooldown({
    cooldownMs: 10,
    maxEntries: 1,
  });
  store.markFailure('first', 0);
  store.markFailure('second', 1);
  expect(store.isCoolingDown('first', 1)).toBe(false);
  expect(store.isCoolingDown('second', 1)).toBe(true);
  expect(store.isCoolingDown('second', 11)).toBe(false);
});
