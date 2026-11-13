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
});

describe('wallet-pay activity rows', () => {
  it('reads a spend paid from the wallet and its refund', () => {
    const page = piggyvestWalletActivityPageSchema.parse({
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          kind: 'wallet_spend',
          direction: 'out',
          amountKobo: 50000,
          label: 'Airtime · MTN · 0803…4567',
          status: 'completed',
          occurredAt: '2026-11-13T10:00:00Z',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          kind: 'wallet_refund',
          direction: 'in',
          amountKobo: 50000,
          label: 'Refund: IMEI check',
          status: 'pending',
          occurredAt: '2026-11-13T11:00:00Z',
        },
      ],
      nextCursor: null,
    });
    expect(page.items.map((item) => item.kind)).toEqual([
      'wallet_spend',
      'wallet_refund',
    ]);
  });
});
