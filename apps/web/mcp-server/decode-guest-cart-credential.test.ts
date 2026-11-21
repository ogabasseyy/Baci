import { expect, it } from 'vitest';
import { decodeGuestCartCredential } from './decode-guest-cart-credential';

it('rejects noncanonical and malformed cart credential encodings before decoding', () => {
  const token = Buffer.alloc(32).toString('base64url');
  expect(decodeGuestCartCredential(token)).toBe('0'.repeat(64));
  for (const invalid of [
    token + '=',
    token + '!',
    token.slice(1),
    token.slice(0, -1) + 'B',
  ]) {
    expect(() => decodeGuestCartCredential(invalid)).toThrow();
  }
});
