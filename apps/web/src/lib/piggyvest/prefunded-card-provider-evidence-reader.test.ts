import { describe, expect, it, vi } from 'vitest';
import { prefundedCardProviderTestFixture as fixture } from './prefunded-card-provider.test-fixture';
import { createPrefundedCardProviderEvidence } from './prefunded-card-provider-evidence';

const configuration = {
  integrationId: fixture.claim.integrationId,
  systemIdentifier: '12345',
  webhookSecret: 'synthetic-key',
  piggyvest: fixture.providerSettings.piggyvest,
};
const evidence = {
  reference: 'transfer-1',
  amountKobo: 5000,
  currency: 'NGN',
  businessId: 'business_1',
  sourceWalletId: 'wallet_source',
  destinationWalletId: 'wallet_destination',
  destinationCustomerId: 'customer_destination',
  providerTransactionId: 'independent-provider-id',
};

describe('stored independent provider evidence reader', () => {
  it.each([
    'operationId',
    'integrationId',
    'merchantId',
    'customerId',
    'goalId',
    'treasuryBindingId',
  ])('refuses another stored %s even when the provider tuple matches', async (key) => {
    const request = {
      ...fixture.claim,
      [key]: '10000000-0000-4000-8000-000000000099',
    };
    const reader = createPrefundedCardProviderEvidence({
      configuration,
      fetchImplementation: vi.fn(),
      execute: async () => ({
        rows: [{ result: { outcome: 'verified_success', evidence, request } }],
      }),
    });
    expect(await reader.verifyTransfer(fixture.claim)).toEqual({
      outcome: 'reconciliation_required',
    });
  });
  it('applies only a persisted event key through the atomic projector', async () => {
    const execute = vi.fn(async () => ({ rows: [{ result: 'applied' }] }));
    const fetchImplementation = vi.fn();
    const reader = createPrefundedCardProviderEvidence({
      configuration,
      execute,
      fetchImplementation,
    });
    expect(await reader.applyInflow('persisted-event')).toBe('applied');
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT prefunded_card.apply_classified_inflow($1::uuid,$2::text,$3::text) AS result',
      [configuration.integrationId, '12345', 'persisted-event']
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it('returns the stored provider transaction identity and never reads HTTP while verifying', async () => {
    const execute = vi.fn(async () => ({
      rows: [
        {
          result: {
            outcome: 'verified_success',
            evidence,
            request: fixture.claim,
          },
        },
      ],
    }));
    const fetchImplementation = vi.fn();
    const reader = createPrefundedCardProviderEvidence({
      configuration,
      execute,
      fetchImplementation,
    });
    expect(await reader.verifyTransfer(fixture.claim)).toEqual({
      outcome: 'verified_success',
      evidence,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT prefunded_card.read_transfer_evidence($1::uuid,$2::text) AS result',
      [fixture.claim.operationId, '12345']
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    'amountKobo',
    'sourceWalletId',
    'destinationWalletId',
    'destinationCustomerId',
    'reference',
    'businessId',
  ])('refuses mismatched stored %s', async (field) => {
    const mismatch = {
      ...evidence,
      [field]: field === 'amountKobo' ? 100 : 'other-value',
    };
    const reader = createPrefundedCardProviderEvidence({
      configuration,
      execute: async () => ({
        rows: [
          {
            result: {
              outcome: 'verified_success',
              evidence: mismatch,
              request: fixture.claim,
            },
          },
        ],
      }),
      fetchImplementation: vi.fn(),
    });
    expect(await reader.verifyTransfer(fixture.claim)).toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it('validates integration before any SQL lookup', async () => {
    const execute = vi.fn();
    const reader = createPrefundedCardProviderEvidence({
      configuration,
      execute,
      fetchImplementation: vi.fn(),
    });
    expect(
      await reader.verifyTransfer({
        ...fixture.claim,
        integrationId: '10000000-0000-4000-8000-000000000010',
      })
    ).toEqual({ outcome: 'reconciliation_required' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a bank attribution result for another event', async () => {
    const reader = createPrefundedCardProviderEvidence({
      configuration,
      fetchImplementation: vi.fn(),
      execute: async () => ({
        rows: [
          {
            result: {
              outcome: 'bank_inflow',
              eventId: 'other-event',
              integrationId: configuration.integrationId,
              merchantId: fixture.claim.merchantId,
              customerId: fixture.claim.customerId,
              goalId: fixture.claim.goalId,
              providerTransactionId: 'bank-tx',
              destinationWalletId: 'wallet_destination',
              destinationCustomerId: 'customer_destination',
              reference: 'bank-ref',
              amountKobo: 1000,
              feeKobo: 0,
              currency: 'NGN',
            },
          },
        ],
      }),
    });
    await expect(reader.classifyInflow('requested-event')).rejects.toThrow(
      'Provider evidence scope refused'
    );
  });
});
