import { describe, expect, it } from 'vitest';
import { primaryWalletBankInboxSchemas } from '@/schemas/primary-wallet-bank-inbox';
import { LIVE_RELAY_LIMITS } from './live-relay-limits';

describe('live relay payload compatibility', () => {
  it('fits the largest forwarded body into the existing bank inbox envelope', () => {
    const rawHex = Buffer.alloc(LIVE_RELAY_LIMITS.bodyBytes).toString('hex');
    expect(
      primaryWalletBankInboxSchemas.enqueue.safeParse({
        rawHex,
        signature: 'a'.repeat(128),
      }).success
    ).toBe(true);
    expect(
      primaryWalletBankInboxSchemas.enqueue.safeParse({
        rawHex: `${rawHex}00`,
        signature: 'a'.repeat(128),
      }).success
    ).toBe(false);
  });
});
