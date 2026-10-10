import { describe, expect, it } from 'vitest';
import { prefundedCardTreasuryVerifierSchema } from './prefunded-card-treasury-verifier';

const configuration = {
  environment: 'staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-09-29T15:59:10Z',
  treasuryBindingId: '10000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'owner-configured-business',
  sourceWalletId: 'owner-configured-source-wallet',
  piggyvest: {
    apiSecret: 'synthetic-staging-secret',
    expectedBusinessId: 'owner-configured-business',
    expectedCurrency: 'NGN',
  },
};

describe('prefundedCardTreasuryVerifierSchema', () => {
  it('accepts owner-configured staging identities for the fixed database and deadline', () => {
    expect(
      prefundedCardTreasuryVerifierSchema.parse(configuration)
    ).toMatchObject({
      expectedBusinessId: 'owner-configured-business',
      sourceWalletId: 'owner-configured-source-wallet',
    });
  });

  it('accepts the exact October 6 lease while rejecting arbitrary dates', () => {
    expect(
      prefundedCardTreasuryVerifierSchema.safeParse({
        ...configuration,
        expiresAt: '2026-10-06T15:59:10Z',
      }).success
    ).toBe(true);
    expect(
      prefundedCardTreasuryVerifierSchema.safeParse({
        ...configuration,
        expiresAt: '2026-10-07T00:00:00Z',
      }).success
    ).toBe(false);
  });

  it.each([
    { environment: 'production' },
    { systemIdentifier: 'other-database' },
    { expiresAt: '2026-09-30T00:00:00Z' },
    {
      piggyvest: {
        ...configuration.piggyvest,
        expectedBusinessId: 'other-business',
      },
    },
    { piggyvest: { ...configuration.piggyvest, expectedCurrency: 'USD' } },
  ])('rejects unsafe staging verifier configuration changes: %o', (change) => {
    expect(
      prefundedCardTreasuryVerifierSchema.safeParse({
        ...configuration,
        ...change,
      }).success
    ).toBe(false);
  });
});
