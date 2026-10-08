import { describe, expect, it } from 'vitest';
import { piggyvestPrimaryWalletStoreSchemas as schemas } from './piggyvest-primary-wallet-store';

describe('primary wallet storage schemas', () => {
  it('requires a claim token for dispatched creation', () => {
    expect(
      schemas.claimedRows.safeParse([
        {
          result: {
            status: 'claimed',
            intentId: '00000000-0000-4000-8000-000000000001',
          },
        },
      ]).success
    ).toBe(false);
  });
  it.each([
    'pending',
    'ready',
    'conflict',
  ])('accepts a durable %s result', (status) => {
    expect(
      schemas.claimedRows.parse([{ result: { status } }])[0].result
    ).toEqual({ status });
  });
  it('rejects missing or duplicated database acknowledgement rows', () => {
    expect(schemas.recordedRows.safeParse([]).success).toBe(false);
    expect(
      schemas.recordedRows.safeParse([{ result: true }, { result: true }])
        .success
    ).toBe(false);
  });
  it('rejects provider details injected into a public claim result', () => {
    expect(
      schemas.claimedRows.safeParse([
        { result: { status: 'ready', bvn: '00000000000' } },
      ]).success
    ).toBe(false);
  });
});
