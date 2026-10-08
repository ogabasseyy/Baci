import { describe, expect, it } from 'vitest';
import { primaryWalletCardFundingFixture as fixture } from './primary-wallet-card-funding.test-fixture';
import { verifyPrimaryWalletCardFundingProof } from './primary-wallet-card-funding-proof';

describe('primary wallet card funding custody proof', () => {
  it('keeps successful Paystack collection pending until PiggyVest custody is verified', () => {
    expect(
      verifyPrimaryWalletCardFundingProof({ ...fixture, transfer: null })
    ).toEqual({ status: 'custody_pending' });
  });

  it('returns a token-free ledger proof for matched collection and primary custody', () => {
    const result = verifyPrimaryWalletCardFundingProof(fixture);
    expect(result).toEqual({
      status: 'ready_to_credit',
      proof: {
        ...fixture.reservation,
        collectionTransactionId: '12345',
        transferTransactionId: 'fixture-transfer-id',
      },
    });
    expect(JSON.stringify(result)).not.toContain('AUTH_');
    expect(JSON.stringify(result)).not.toContain('fixture-signature');
  });

  it.each([
    ['reference', 'wrong-reference'],
    ['amount', 24999],
    ['currency', 'USD'],
    ['business_id', 'another-business'],
    ['source_wallet', 'another-treasury'],
    ['destination_wallet', 'fixture-savings-goal'],
    ['destination_customer_id', 'another-customer'],
    ['fee', 100],
    ['status', 'pending'],
  ])('rejects a transfer with mismatched %s', (field, value) => {
    expect(
      verifyPrimaryWalletCardFundingProof({
        ...fixture,
        transfer: {
          ...fixture.transfer,
          data: { ...fixture.transfer.data, [field]: value },
        },
      })
    ).toEqual({ status: 'reconciliation_required' });
  });

  it.each([
    ['intentId', '10000000-0000-4000-8000-000000000009'],
    ['reference', 'pvb-first-10000000-0000-4000-8000-000000000009'],
    ['amountKobo', 24999],
    ['currency', 'USD'],
    ['domain', 'live'],
  ])('rejects a collection with mismatched %s', (field, value) => {
    expect(
      verifyPrimaryWalletCardFundingProof({
        ...fixture,
        collection: {
          ...fixture.collection,
          collection: { ...fixture.collection.collection, [field]: value },
        },
      })
    ).toEqual({ status: 'reconciliation_required' });
  });

  it('rejects another customer card collection', () => {
    const collection = fixture.collection.collection;
    expect(
      verifyPrimaryWalletCardFundingProof({
        ...fixture,
        collection: {
          outcome: 'verified',
          collection: {
            ...collection,
            authorization: {
              ...collection.authorization,
              email: 'other@example.test',
            },
          },
        },
      })
    ).toEqual({ status: 'reconciliation_required' });
  });

  it('keeps an unverified collection pending even when a transfer exists', () => {
    expect(
      verifyPrimaryWalletCardFundingProof({
        ...fixture,
        collection: { outcome: 'pending' },
      })
    ).toEqual({ status: 'collection_pending' });
  });

  it('rejects an uncorroborated rich provider response', () => {
    expect(
      verifyPrimaryWalletCardFundingProof({
        ...fixture,
        transfer: { status: true, data: { status: 'successful' } },
      })
    ).toEqual({ status: 'reconciliation_required' });
  });
});
