import { describe, expect, it, vi } from 'vitest';
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
  it.each([
    ['pending', 'pending'],
    ['failed', 'failed'],
  ] as const)('reports bound %s evidence as %s', async (status, outcome) => {
    const { lookup } = lookupWith({
      ...success,
      data: { ...success.data, status },
    });
    expect(await lookup()).toBe(outcome);
  });
  it('reports uncertain for malformed provider evidence', async () => {
    for (const body of [
      { status: true, data: { status: 'successful' } },
      'not-json-at-all{{{',
    ]) {
      const { lookup } = lookupWith(body);
      expect(await lookup()).toBe('uncertain');
    }
  });
  it('reports a 404 as not found, never as proof the transfer is absent', async () => {
    // docs/piggyvest-contract-evidence/2026-10-31.md, P2: a just-accepted
    // transfer answers 404 before it is indexed, exactly like a reference
    // that never existed.
    const { lookup } = lookupWith(
      { status: false, message: 'Transaction Not Found', data: {} },
      404
    );
    expect(await lookup()).toBe('not_found');
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
});
