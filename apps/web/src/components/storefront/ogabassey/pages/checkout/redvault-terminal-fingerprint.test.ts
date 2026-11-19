import { describe, expect, it } from 'vitest';
import { redvaultTerminalFingerprintMatches } from './redvault-terminal-fingerprint';

const previous = {
  merchantId: 'merchant',
  customerEmail: 'buyer@example.test',
  shippingFee: 0,
  shippingAddress: { address: 'pickup' },
  items: [{ product_id: 'product', quantity: 1, price: 100 }],
};
const fingerprint = (value: unknown) => `uba_redvault:${JSON.stringify(value)}`;

describe('REDVAULT terminal cart continuation', () => {
  it('retains the reviewed item identity when the completed cart empties', () => {
    expect(redvaultTerminalFingerprintMatches(
      fingerprint(previous), fingerprint({ ...previous, items: [] })
    )).toBe(true);
  });
  it.each([
    { ...previous, items: [], customerEmail: 'different@example.test' },
    { ...previous, items: [], shippingFee: 1 },
    { ...previous, items: [{ product_id: 'other', quantity: 1, price: 100 }] },
  ])('rejects changed checkout details or a new cart', (current) => {
    expect(redvaultTerminalFingerprintMatches(fingerprint(previous), fingerprint(current))).toBe(false);
  });
  it('fails closed for malformed fingerprints or an empty original cart', () => {
    expect(redvaultTerminalFingerprintMatches('bad', fingerprint({ ...previous, items: [] }))).toBe(false);
    expect(redvaultTerminalFingerprintMatches(fingerprint({ ...previous, items: [] }), fingerprint({ ...previous, items: [] }))).toBe(false);
  });
});
