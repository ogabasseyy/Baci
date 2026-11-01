import { expect, it } from 'vitest';
import { hasUnsupportedLegacyEditIdentity } from './legacy-cart-edit-identity';

it('permits condition only when a specific offer was selected', () => {
  expect(hasUnsupportedLegacyEditIdentity({ condition: 'used' }, true)).toBe(
    false
  );
  expect(hasUnsupportedLegacyEditIdentity({ condition: 'used' }, false)).toBe(
    true
  );
});
it.each([
  { variantId: 'v' },
  { voucherToken: 'v' },
  { voucherAwardId: 'v' },
  { options: { color: 'blue' } },
])('continues rejecting unsupported identity or attachment %o for exact offers', (line) => {
  expect(hasUnsupportedLegacyEditIdentity(line, true)).toBe(true);
});
