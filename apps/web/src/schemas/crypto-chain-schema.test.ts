import { describe, expect, it } from 'vitest';
import { cryptoChainSchema } from './crypto-chain-schema';

describe('cryptoChainSchema', () => {
  it.each([
    ['ethereum', 'ETH'],
    ['polygon', 'MATIC'],
    ['tron', 'TRX'],
    ['avalanche', 'AVAXC'],
    ['ETH', 'ETH'],
  ])('normalizes provider chain %s to %s', (input, expected) => {
    expect(cryptoChainSchema.parse(input)).toBe(expected);
  });

  it('rejects unsupported chains', () => {
    expect(cryptoChainSchema.safeParse('solana').success).toBe(false);
  });
});
