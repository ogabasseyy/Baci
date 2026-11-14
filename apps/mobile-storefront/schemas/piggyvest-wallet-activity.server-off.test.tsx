import { describe, expect, it } from '@jest/globals';
import { piggyvestWalletActivityPageSchema } from './piggyvest-wallet-activity';

describe('PiggyVest wallet activity page schema with the server keeping PiggyVest off', () => {
  it('rejects the not-ready error body instead of reading it as an empty list', () => {
    expect(
      piggyvestWalletActivityPageSchema.safeParse({
        error: 'Wallet activity is temporarily unavailable.',
        code: 'PIGGYVEST_NOT_READY',
      }).success
    ).toBe(false);
  });

  it('accepts an empty last page', () => {
    expect(
      piggyvestWalletActivityPageSchema.parse({ items: [], nextCursor: null })
    ).toEqual({ items: [], nextCursor: null });
  });

  it('bugfix: rejects a row whose occurredAt is not an ISO datetime (its cursor would fail to decode)', () => {
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'bank_transfer',
      direction: 'in',
      amountKobo: 5000,
      feeKobo: 0,
      label: 'Money added',
      status: 'completed',
    };
    const parse = (occurredAt: string) =>
      piggyvestWalletActivityPageSchema.safeParse({
        items: [{ ...row, occurredAt }],
        nextCursor: null,
      }).success;
    expect(parse('2026-11-13T10:00:00+00:00')).toBe(true);
    expect(parse('yesterday')).toBe(false);
  });
});
