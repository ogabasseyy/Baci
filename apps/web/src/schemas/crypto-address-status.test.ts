import { describe, expect, it } from 'vitest';
import { cryptoAddressStatusSchema } from './crypto-address-status';

it.each([
  null,
  { address: 'wallet', chain: 'TRX', currency: 'USDT' },
])('accepts a pending or complete status: %j', (crypto_address) => {
  const result = cryptoAddressStatusSchema.safeParse({
    success: true,
    crypto_address,
  });
  expect(result.success).toBe(true);
});
describe('bugfix: accept terminal status responses without an address', () => {
  it('parses success payloads that omit crypto_address entirely', () => {
    const result = cryptoAddressStatusSchema.safeParse({
      success: true,
      status: 'expired',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.crypto_address).toBeUndefined();
  });
});
it.each([
  ['ethereum', 'ETH'],
  ['polygon', 'MATIC'],
  ['tron', 'TRX'],
  ['avalanche', 'AVAXC'],
  [' ETH ', 'ETH'],
])('normalizes provider chain %s to %s', (chain, expected) => {
  const result = cryptoAddressStatusSchema.safeParse({
    success: true,
    status: 'CANCELLED',
    crypto_address: { address: 'wallet', chain, currency: 'USDT' },
  });
  expect(result.success).toBe(true);
  if (result.success)
    expect(result.data).toMatchObject({
      status: 'cancelled',
      crypto_address: { chain: expected },
    });
});
it('rejects unsupported provider networks', () => {
  const result = cryptoAddressStatusSchema.safeParse({
    success: true,
    crypto_address: { address: 'wallet', chain: 'bitcoin', currency: 'USDT' },
  });
  expect(result.success).toBe(false);
});
