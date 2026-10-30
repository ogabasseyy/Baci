import { describe, expect, it, vi } from 'vitest';
import { resubmitReclaimedSavingsDispatch } from './primary-wallet-savings-transfer';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';

const selection = {
  reference: 'pvb-save-00000000-0000-4000-8000-000000000002',
  walletId: 'source',
  amountKobo: 10000,
  destinationWalletId: 'destination',
  token: 'test-token',
  baseUrl: 'https://staging.piggyvest.business',
};
const success = {
  status: true,
  data: {
    status: 'successful',
    id: 'provider-transaction',
    internal_reference: 'provider-transaction',
    reference: 'provider-reference',
    third_party_reference: selection.reference,
    amount: 10000,
    fee: 0,
    customer_id: 'source-customer',
    source_wallet: 'source',
    destination_wallet: 'destination',
  },
};
function lookupWith(body: unknown, status = 200) {
  const fetchImplementation = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })
  );
  return {
    fetchImplementation,
    lookup: () =>
      lookupSavingsTransferReference({ ...selection, fetchImplementation }),
  };
}

describe('savings transfer reference lookup', () => {
  it('reports submitted only for provider evidence bound to the reservation', async () => {
    const { fetchImplementation, lookup } = lookupWith(success);
    expect(await lookup()).toBe('submitted');
    expect(fetchImplementation).toHaveBeenCalledWith(
      `${selection.baseUrl}/api/v1/transaction/verify?reference=${encodeURIComponent(selection.reference)}&wallet_id=source`,
      expect.objectContaining({ method: 'GET' })
    );
  });
  it.each([
    { third_party_reference: 'another-reference' },
    { amount: 9999 },
    { source_wallet: 'another-wallet' },
    { destination_wallet: 'another-wallet' },
  ])('reports uncertain for unbound success evidence: %j', async (change) => {
    const { lookup } = lookupWith({
      ...success,
      data: { ...success.data, ...change },
    });
    expect(await lookup()).toBe('uncertain');
  });
  it('reports uncertain for failed or malformed provider evidence', async () => {
    for (const body of [
      { ...success, data: { ...success.data, status: 'failed' } },
      { status: true, data: { status: 'successful' } },
      'not-json-at-all{{{',
    ]) {
      const { lookup } = lookupWith(body);
      expect(await lookup()).toBe('uncertain');
    }
  });
  it.each([
    ['generic JSON error', { status: false, message: 'not found' }],
    ['HTML error page', '<html><body>not found</body></html>'],
    ['malformed response', 'not-json-at-all{{{'],
  ])('reports uncertain for a 404 with %s because absence is unverified', async (_label, body) => {
    const { lookup } = lookupWith(body, 404);
    expect(await lookup()).toBe('uncertain');
  });
  it.each([
    400, 429, 500,
  ])('reports uncertain on HTTP %i instead of proving absence', async (status) => {
    const { lookup } = lookupWith({ status: false }, status);
    expect(await lookup()).toBe('uncertain');
  });
  it('reports uncertain when the provider is unreachable', async () => {
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error('connection lost'));
    expect(
      await lookupSavingsTransferReference({
        ...selection,
        fetchImplementation,
      })
    ).toBe('uncertain');
  });
  it('reports uncertain when the provider lookup times out', async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn(
        () => new Promise<Response>(() => undefined)
      );
      const lookup = lookupSavingsTransferReference({
        ...selection,
        fetchImplementation,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await lookup).toBe('uncertain');
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ['pending', { ...success, data: { ...success.data, status: 'pending' } }],
    ['unknown', { ...success, data: { ...success.data, status: 'unknown' } }],
  ])('reports uncertain for a matching reference with %s status', async (_label, body) => {
    const { lookup } = lookupWith(body);
    expect(await lookup()).toBe('uncertain');
  });
  it('does not release or redispatch a reclaimed transfer after a generic 404 lookup', async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: false, message: 'not found' }), {
        status: 404,
      })
    );
    const retrieveWallet = vi.fn();
    const transfer = vi.fn();
    const releaseAfterRejection = vi.fn();

    const result = await resubmitReclaimedSavingsDispatch(
      {
        operationId: 'operation',
        goalId: 'goal',
        amountKobo: selection.amountKobo,
        sourceWalletId: selection.walletId,
        destinationWalletId: selection.destinationWalletId,
        businessId: 'business',
        providerCustomerId: 'customer',
        reference: selection.reference,
      },
      {
        lookupTransfer: async () =>
          await lookupSavingsTransferReference({
            ...selection,
            fetchImplementation,
          }),
        retrieveWallet,
        transfer,
        releaseAfterRejection,
      }
    );

    expect(result).toBe('pending');
    expect(retrieveWallet).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();
    expect(releaseAfterRejection).not.toHaveBeenCalled();
  });
});
