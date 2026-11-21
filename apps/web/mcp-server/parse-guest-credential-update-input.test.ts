import { expect, it } from 'vitest';
import { parseGuestCredentialUpdateInput } from './parse-guest-credential-update-input';

const product_id = '11111111-1111-4111-8111-111111111111';

it('returns a validated update with the decoded canonical credential', () => {
  expect(parseGuestCredentialUpdateInput({
    product_id, quantity: 0, cartCredential: 'A'.repeat(43),
  })).toMatchObject({ success: true, data: { product_id, quantity: 0, cart_token: '0'.repeat(64) } });
});

it('rejects raw, noncanonical, and missing removal credentials without throwing', () => {
  expect(parseGuestCredentialUpdateInput({ product_id, cart_token: '0'.repeat(64) }).success).toBe(false);
  expect(parseGuestCredentialUpdateInput({ product_id, cartCredential: 'A'.repeat(42) + 'B' }).success).toBe(false);
  expect(parseGuestCredentialUpdateInput({ product_id, quantity: 0 }).success).toBe(false);
});
