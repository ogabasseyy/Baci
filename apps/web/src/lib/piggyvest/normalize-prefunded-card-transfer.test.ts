import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePrefundedCardTransfer } from './normalize-prefunded-card-transfer';
import { prefundedCardTransferVerificationFixture as fixture } from './prefunded-card-transfer-verification.test-fixture';

vi.mock('server-only', () => ({}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T16:00:00.000Z');
});
afterEach(() => vi.useRealTimers());

function input() {
  return structuredClone({
    claim: fixture.claim,
    response: fixture.transaction,
    expectedSystemIdentifier: '123',
    corroboration: {
      retrievedAt: fixture.ownership.observedAt,
      sourceWallet: fixture.sourceWallet,
      destinationWallet: fixture.destinationWallet,
      ownership: fixture.ownership,
    },
  });
}

describe('rich transfer identity and finality', () => {
  it('does not confuse provider reference or business customer with the transfer reference or destination owner', () => {
    const result = normalizePrefundedCardTransfer(input());
    expect(result).toMatchObject({
      outcome: 'verified_success',
      evidence: {
        reference: 'pvbt-synthetic-transfer',
        destinationCustomerId: 'customer_destination',
        amountKobo: 10000,
      },
    });
  });

  it.each([
    ['third_party_reference', 'foreign-reference'],
    ['status', 'success'],
    ['id', 42],
    ['internal_reference', 'different-id'],
    ['amount', 9999],
    ['amount', 10000.5],
    ['amount', Number.MAX_SAFE_INTEGER + 1],
    ['fee', 1],
    ['customer_id', 'customer_destination'],
    ['source_wallet', 'foreign-source'],
    ['destination_wallet', 'foreign-destination'],
    ['destination_wallet', 'wallet_source'],
    ['currency', 'USD'],
    ['business_id', 'foreign-business'],
    ['destination_customer_id', 'foreign-owner'],
  ])('refuses mismatched or malformed rich field %s', (field, value) => {
    const selected = input();
    selected.response.data = { ...selected.response.data, [field]: value };
    expect(normalizePrefundedCardTransfer(selected)).toEqual({
      outcome: 'deferred',
    });
  });

  it('never falls back to a direct reference when third-party reference is absent', () => {
    const selected = input();
    const { third_party_reference: _reference, ...data } =
      selected.response.data;
    expect(
      normalizePrefundedCardTransfer({
        ...selected,
        response: {
          status: true,
          data: { ...data, reference: selected.claim.transferReference },
        },
      })
    ).toEqual({ outcome: 'deferred' });
  });

  it.each([
    'integrationId',
    'merchantId',
    'customerId',
    'goalId',
    'providerWalletId',
    'providerCustomerId',
    'systemIdentifier',
  ])('refuses a foreign trusted binding %s', (field) => {
    const selected = input();
    selected.corroboration.ownership.binding = {
      ...selected.corroboration.ownership.binding,
      [field]: 'foreign',
    };
    expect(normalizePrefundedCardTransfer(selected)).toEqual({
      outcome: 'deferred',
    });
  });

  it.each([
    'integrationId',
    'merchantId',
    'customerId',
    'businessId',
    'publicWalletId',
    'apiCustomerId',
    'webhookCustomerId',
    'evidenceSha256',
  ])('refuses a mismatched crosswalk %s', (field) => {
    const selected = input();
    selected.corroboration.ownership.crosswalk = {
      ...selected.corroboration.ownership.crosswalk,
      [field]: 'foreign',
    };
    expect(normalizePrefundedCardTransfer(selected)).toEqual({
      outcome: 'deferred',
    });
  });

  it.each([
    'sourceWallet',
    'destinationWallet',
  ] as const)('requires the %s authenticated public identity, business and currency', (wallet) => {
    for (const [field, value] of [
      ['id', 'foreign-wallet'],
      ['business_id', 'foreign-business'],
      ['currency', 'USD'],
      ['status', 'inactive'],
    ]) {
      const selected = input();
      selected.corroboration[wallet].data = {
        ...selected.corroboration[wallet].data,
        [field]: value,
      };
      expect(normalizePrefundedCardTransfer(selected)).toEqual({
        outcome: 'deferred',
      });
    }
  });

  it('does not replace a missing API alias with the expected webhook customer', () => {
    const selected = input();
    const { api_customer_id: _alias, ...data } =
      selected.corroboration.destinationWallet.data;
    expect(
      normalizePrefundedCardTransfer({
        ...selected,
        corroboration: {
          ...selected.corroboration,
          destinationWallet: { status: true, data },
        },
      })
    ).toEqual({ outcome: 'deferred' });
  });

  it('refuses a disabled binding, failed wallet envelope, missing proof or wrong physical pin', () => {
    const selected = input();
    expect(
      normalizePrefundedCardTransfer({ ...selected, corroboration: undefined })
    ).toEqual({ outcome: 'deferred' });
    expect(
      normalizePrefundedCardTransfer({
        ...selected,
        expectedSystemIdentifier: '456',
      })
    ).toEqual({ outcome: 'deferred' });
    expect(
      normalizePrefundedCardTransfer({
        ...selected,
        corroboration: {
          ...selected.corroboration,
          ownership: {
            ...selected.corroboration.ownership,
            binding: {
              ...selected.corroboration.ownership.binding,
              enabled: false,
            },
          },
        },
      })
    ).toEqual({ outcome: 'deferred' });
    expect(
      normalizePrefundedCardTransfer({
        ...selected,
        corroboration: {
          ...selected.corroboration,
          sourceWallet: {
            ...selected.corroboration.sourceWallet,
            status: false,
          },
        },
      })
    ).toEqual({ outcome: 'deferred' });
  });

  it('bounds both wallet retrieval and binding freshness to sixty seconds with no public clock override', () => {
    const selected = input();
    vi.setSystemTime('2026-10-02T16:01:00.000Z');
    expect(normalizePrefundedCardTransfer(selected).outcome).toBe(
      'verified_success'
    );
    vi.setSystemTime('2026-10-02T16:01:00.001Z');
    expect(normalizePrefundedCardTransfer(selected)).toEqual({
      outcome: 'deferred',
    });
    vi.setSystemTime('2026-10-02T15:59:59.999Z');
    expect(normalizePrefundedCardTransfer(selected)).toEqual({
      outcome: 'deferred',
    });
  });

  it('refuses an expired crosswalk even with fresh readbacks', () => {
    const selected = input();
    selected.corroboration.ownership.crosswalk.expiresAt =
      '2026-10-02T16:00:00.000Z';
    expect(normalizePrefundedCardTransfer(selected)).toEqual({
      outcome: 'deferred',
    });
  });

  it('refuses contradictory third-party references on a flat normalized receipt', () => {
    const response = {
      status: true,
      data: {
        status: 'success',
        id: 'normalized-id',
        reference: fixture.claim.transferReference,
        third_party_reference: 'foreign-transfer',
        amount: 10000,
        currency: 'NGN',
        business_id: 'business_1',
        source_wallet: 'wallet_source',
        destination_wallet: 'wallet_destination',
        destination_customer_id: 'customer_destination',
      },
    };
    expect(
      normalizePrefundedCardTransfer({ claim: fixture.claim, response })
    ).toEqual({ outcome: 'deferred' });
  });
});
