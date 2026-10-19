import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { collectPrefundedCardTransferProof } from './collect-prefunded-card-transfer-proof';
import { prefundedCardTransferVerificationFixture as fixture } from './prefunded-card-transfer-verification.test-fixture';

vi.mock('server-only', () => ({}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T16:00:00.000Z');
});
afterEach(() => vi.useRealTimers());

function options() {
  const fetchImplementation = vi
    .fn()
    .mockImplementation(async (url: string) =>
      Response.json(
        url.includes('/transaction/verify?')
          ? fixture.transaction
          : url.endsWith('/wallet_source')
            ? fixture.sourceWallet
            : fixture.destinationWallet
      )
    );
  return {
    settings: fixture.settings,
    claim: fixture.claim,
    fetchImplementation,
    expectedSystemIdentifier: '123',
    resolveOwnership: vi.fn().mockResolvedValue(fixture.ownership),
  };
}

it('collects only authenticated bounded GETs and cannot submit another transfer', async () => {
  const selected = options();
  expect(await collectPrefundedCardTransferProof(selected)).toMatchObject({
    outcome: 'verified_success',
  });
  expect(selected.fetchImplementation).toHaveBeenCalledTimes(3);
  for (const [, init] of selected.fetchImplementation.mock.calls) {
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe('Bearer pv_staging_example');
  }
});

it('preserves the generic flat contract without inventing a rich response or crosswalk', async () => {
  const selected = options();
  selected.fetchImplementation.mockResolvedValue(
    Response.json({
      status: true,
      data: {
        status: 'success',
        id: 'flat-provider-id',
        reference: fixture.claim.transferReference,
        amount: fixture.claim.amountKobo,
        currency: fixture.claim.currency,
        business_id: fixture.claim.businessId,
        source_wallet: fixture.claim.sourceWalletId,
        destination_wallet: fixture.claim.destinationWalletId,
        destination_customer_id: fixture.claim.destinationCustomerId,
      },
    })
  );
  expect(await collectPrefundedCardTransferProof(selected)).toMatchObject({
    outcome: 'verified_success',
    evidence: { providerTransactionId: 'flat-provider-id' },
  });
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
  expect(selected.resolveOwnership).not.toHaveBeenCalled();
});

it('refuses foreign immutable scope before any provider or ownership read', async () => {
  const selected = options();
  selected.claim = { ...selected.claim, sourceWalletId: 'foreign-source' };
  expect(await collectPrefundedCardTransferProof(selected)).toEqual({
    outcome: 'reconciliation_required',
  });
  expect(selected.fetchImplementation).not.toHaveBeenCalled();
  expect(selected.resolveOwnership).not.toHaveBeenCalled();
});

it.each([
  'status',
  'amount',
  'third_party_reference',
  'customer_id',
  'destination_wallet',
])('does not corroborate mismatched transaction %s', async (field) => {
  const selected = options();
  selected.fetchImplementation.mockResolvedValue(
    Response.json({
      ...fixture.transaction,
      data: { ...fixture.transaction.data, [field]: 'foreign' },
    })
  );
  expect(await collectPrefundedCardTransferProof(selected)).toEqual({
    outcome: 'deferred',
  });
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
  expect(selected.resolveOwnership).not.toHaveBeenCalled();
});

it('fails closed on ownership read errors without exposing their contents', async () => {
  const selected = options();
  selected.resolveOwnership.mockRejectedValue(
    new Error('private root artifact contents')
  );
  expect(await collectPrefundedCardTransferProof(selected)).toEqual({
    outcome: 'deferred',
  });
  expect(selected.fetchImplementation).toHaveBeenCalledOnce();
});

it('fails closed when a wallet request redirects or is incomplete', async () => {
  const selected = options();
  selected.fetchImplementation.mockImplementation(async (url: string) =>
    url.includes('/transaction/verify?')
      ? Response.json(fixture.transaction)
      : new Response('', { status: 302 })
  );
  expect(await collectPrefundedCardTransferProof(selected)).toEqual({
    outcome: 'deferred',
  });
});

it('does not allow fresh wallet reads to refresh a stale ownership snapshot', async () => {
  const selected = options();
  selected.resolveOwnership.mockResolvedValue({
    ...fixture.ownership,
    observedAt: '2026-10-02T15:58:00.000Z',
  });
  expect(await collectPrefundedCardTransferProof(selected)).toEqual({
    outcome: 'deferred',
  });
});
