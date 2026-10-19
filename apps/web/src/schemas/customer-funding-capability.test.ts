import { describe, expect, it } from 'vitest';
import { customerFundingCapabilitySchema } from './customer-funding-capability';

const uuid = '00000000-0000-4000-8000-000000000000';
const termsHash = 'a'.repeat(64);

const capability = {
  identity: {
    environment: 'staging',
    integrationId: uuid,
    merchantId: uuid,
    customerId: uuid,
    goalId: uuid,
    providerWalletId: 'wallet-1',
    providerCustomerId: 'customer-1',
  },
  policy: {
    revisionId: uuid,
    command: {
      revisionId: uuid,
      expectedGoalUpdatedAt: '2026-10-01T00:00:00Z',
      productId: uuid,
      variantId: null,
      termsVersion: 'v1',
      termsHash,
      quoteId: 'quote-1',
      quoteKobo: 100,
      quoteExpiresAt: '2026-10-02T00:00:00Z',
      guarantee: null,
      lifecycle: 'draft',
      collectionPaused: true,
    },
    device: {
      name: 'Phone',
      condition: 'new',
      variantId: null,
      variantLabel: null,
      selectionStatus: 'exact',
    },
    actorId: null,
    acceptedAt: null,
    durationMonths: 3,
  },
  ledgerSnapshot: {
    ledger: {
      confirmedPrincipalKobo: 0,
      reservedPrincipalKobo: 0,
      paidEligibleInterestKobo: 0,
      reservedPaidInterestKobo: 0,
      pendingInterestKobo: 0,
    },
    activeReservation: null,
    fundingReversed: false,
  },
};

describe('customerFundingCapabilitySchema', () => {
  it('accepts a valid capability row', () => {
    expect(
      customerFundingCapabilitySchema.safeParse([{ result: capability }])
        .success
    ).toBe(true);
  });

  it('accepts a null capability result', () => {
    expect(
      customerFundingCapabilitySchema.safeParse([{ result: null }]).success
    ).toBe(true);
  });

  it('rejects a revision mismatch between policy and command', () => {
    const mismatched = {
      ...capability,
      policy: {
        ...capability.policy,
        revisionId: '11111111-1111-4111-8111-111111111111',
      },
    };
    expect(
      customerFundingCapabilitySchema.safeParse([{ result: mismatched }])
        .success
    ).toBe(false);
  });

  it('requires exactly one row', () => {
    expect(customerFundingCapabilitySchema.safeParse([]).success).toBe(false);
  });
});
