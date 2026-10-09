import { describe, expect, it } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { verifyPrimaryCardCustodyProof } from './primary-wallet-card-custody-proof';

describe('primary custody economic and identity proof', () => {
  it('does not assume canonical webhook and transaction customers equal the business ID', () => {
    const result = verifyPrimaryCardCustodyProof({
      ...fixture,
      crosswalk: {
        ...fixture.crosswalk,
        treasuryWebhookCustomerId: 'source-webhook-customer',
        transactionCustomerId: 'transaction-customer',
      },
      envelope: { ...fixture.envelope, customer_id: 'source-webhook-customer' },
      single: {
        ...fixture.single,
        data: { ...fixture.single.data, customer_id: 'transaction-customer' },
      },
    });
    expect(result.status).toBe('verified');
  });
  it('binds signed internal custody to a complete authenticated bank alias crosswalk', () => {
    const result = verifyPrimaryCardCustodyProof(fixture);
    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.proof.transactionAliases).toEqual([
        'bank-transfer',
        'canonical-transfer',
      ]);
      expect(result.proof.amountKobo).toBe(25000);
      expect(result.proof).not.toHaveProperty('authorizationCode');
      expect(result.proof.inboxToken).toBe(fixture.inboxToken);
    }
  });
  it.each([
    ['unverified crosswalk', { crosswalk: null }],
    [
      'incomplete aliases',
      { crosswalk: { ...fixture.crosswalk, aliasesComplete: false } },
    ],
    [
      'bank alias omitted',
      {
        crosswalk: {
          ...fixture.crosswalk,
          transactionAliases: ['canonical-transfer'],
        },
      },
    ],
    [
      'duplicate aliases',
      {
        crosswalk: {
          ...fixture.crosswalk,
          transactionAliases: ['canonical-transfer', 'canonical-transfer'],
        },
      },
    ],
    [
      'foreign integration',
      {
        crosswalk: {
          ...fixture.crosswalk,
          integrationId: fixture.context.customerId,
        },
      },
    ],
    [
      'foreign merchant',
      {
        crosswalk: {
          ...fixture.crosswalk,
          merchantId: fixture.context.customerId,
        },
      },
    ],
    [
      'foreign customer',
      {
        crosswalk: {
          ...fixture.crosswalk,
          customerId: fixture.context.merchantId,
        },
      },
    ],
    [
      'wrong API customer',
      { crosswalk: { ...fixture.crosswalk, apiCustomerId: 'other' } },
    ],
    [
      'wrong webhook customer',
      { crosswalk: { ...fixture.crosswalk, webhookCustomerId: 'other' } },
    ],
    ['invalid clock', { now: Number.NaN }],
    [
      'foreign source',
      {
        single: {
          ...fixture.single,
          data: { ...fixture.single.data, source_wallet: 'other' },
        },
      },
    ],
    [
      'foreign destination',
      {
        single: {
          ...fixture.single,
          data: { ...fixture.single.data, destination_wallet: 'other' },
        },
      },
    ],
    [
      'nonzero fee',
      {
        single: { ...fixture.single, data: { ...fixture.single.data, fee: 1 } },
      },
    ],
    [
      'wrong amount',
      {
        single: {
          ...fixture.single,
          data: { ...fixture.single.data, amount: 24999 },
        },
      },
    ],
    [
      'bank summary instead of internal transfer',
      {
        single: {
          ...fixture.single,
          data: { ...fixture.single.data, category: 'bank-inflow' },
        },
      },
    ],
    [
      'failed TSQ',
      {
        verification: {
          ...fixture.verification,
          data: { ...fixture.verification.data, status: 'pending' },
        },
      },
    ],
    [
      'wrong TSQ reference',
      {
        verification: {
          ...fixture.verification,
          data: { ...fixture.verification.data, reference: 'other' },
        },
      },
    ],
    [
      'wrong signed root',
      { envelope: { ...fixture.envelope, customer_id: 'other' } },
    ],
    [
      'unmapped signed bank ID',
      {
        envelope: {
          ...fixture.envelope,
          eventData: { transaction_id: 'other' },
        },
      },
    ],
    [
      'inactive destination',
      {
        destinationWallet: {
          ...fixture.destinationWallet,
          data: { ...fixture.destinationWallet.data, status: 'inactive' },
        },
      },
    ],
    [
      'foreign wallet business',
      {
        destinationWallet: {
          ...fixture.destinationWallet,
          data: { ...fixture.destinationWallet.data, business_id: 'other' },
        },
      },
    ],
  ])('defers %s without manufacturing custody', (_label, change) => {
    expect(verifyPrimaryCardCustodyProof({ ...fixture, ...change })).toEqual({
      status: 'deferred',
    });
  });
  it.each([
    ['stale crosswalk', { now: fixture.now + 60001 }],
    ['future crosswalk', { now: fixture.now - 2000 }],
  ])('verifies %s against live provider reads instead of stranding it', (_label, change) => {
    expect(
      verifyPrimaryCardCustodyProof({ ...fixture, ...change }).status
    ).toBe('verified');
  });
});
