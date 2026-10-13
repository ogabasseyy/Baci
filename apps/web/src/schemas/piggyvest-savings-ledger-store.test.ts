import { describe, expect, it } from 'vitest';
import { piggyvestSavingsLedgerStoreSchemas as schemas } from './piggyvest-savings-ledger-store';

describe('internal ledger storage schemas', () => {
  it('requires exactly one acknowledgement', () => {
    const row = {
      result: {
        operationId: '11111111-1111-4111-8111-111111111111',
        outcome: 'recorded',
      },
    };
    expect(schemas.acknowledgement.safeParse([row]).success).toBe(true);
    expect(schemas.acknowledgement.safeParse([]).success).toBe(false);
    expect(schemas.acknowledgement.safeParse([row, row]).success).toBe(false);
  });
  it('rejects incomplete and caller-supplied provider identities', () => {
    expect(
      schemas.identity.safeParse({ merchantId: 'synthetic' }).success
    ).toBe(false);
    expect(
      schemas.identity.safeParse({
        integrationId: null,
        providerWalletId: 'wallet',
      }).success
    ).toBe(false);
  });
});
