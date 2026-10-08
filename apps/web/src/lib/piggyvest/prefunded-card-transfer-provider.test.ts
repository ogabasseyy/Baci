import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrefundedCardProvider } from './prefunded-card-provider';
import { prefundedCardTransferVerificationFixture as fixture } from './prefunded-card-transfer-verification.test-fixture';

vi.mock('server-only', () => ({}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-10-02T16:00:00.000Z');
});
afterEach(() => vi.useRealTimers());

function provider(ownership: unknown = fixture.ownership) {
  const fetchImplementation = vi
    .fn()
    .mockImplementation(async (url: string) => {
      if (url.includes('/transaction/verify?'))
        return Response.json(fixture.transaction);
      if (url.endsWith('/wallet/wallet_source'))
        return Response.json(fixture.sourceWallet);
      if (url.endsWith('/wallet/wallet_destination'))
        return Response.json(fixture.destinationWallet);
      throw new Error('Unexpected provider path');
    });
  return {
    fetchImplementation,
    service: createPrefundedCardProvider({
      settings: fixture.settings,
      fetchImplementation,
      resolveSavedMethod: vi.fn(),
      expectedSystemIdentifier: '123',
      resolveTransferOwnership: async () => ownership,
    }),
  };
}

describe('bugfix: rich successful transfer TSQ is not a flat transfer receipt', () => {
  it('verifies captured-shaped sandbox transfer only through fresh wallet and ownership corroboration', async () => {
    const { service, fetchImplementation } = provider();

    await expect(service.verifyTransfer(fixture.claim)).resolves.toEqual({
      outcome: 'verified_success',
      evidence: {
        reference: 'pvbt-synthetic-transfer',
        amountKobo: 10000,
        currency: 'NGN',
        businessId: 'business_1',
        sourceWalletId: 'wallet_source',
        destinationWalletId: 'wallet_destination',
        destinationCustomerId: 'customer_destination',
        providerTransactionId: 'PVBsynthetic-transfer-id',
      },
    });
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      'https://staging.piggyvest.business/api/v1/transaction/verify?reference=pvbt-synthetic-transfer&wallet_id=wallet_source',
      'https://staging.piggyvest.business/api/v1/wallet/wallet_source',
      'https://staging.piggyvest.business/api/v1/wallet/wallet_destination',
    ]);
    for (const [, options] of fetchImplementation.mock.calls) {
      expect(options).toMatchObject({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      });
    }
  });

  it('does not substitute the expected destination customer without a crosswalk', async () => {
    const { service, fetchImplementation } = provider(null);
    await expect(service.verifyTransfer(fixture.claim)).resolves.toEqual({
      outcome: 'deferred',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it('does not admit owner-reviewed identity as generic unattended runtime authority', async () => {
    const { service, fetchImplementation } = provider({
      ...fixture.ownership,
      crosswalk: {
        ...fixture.ownership.crosswalk,
        authority: 'owner_reviewed_provisioning_identity',
      },
    });
    await expect(service.verifyTransfer(fixture.claim)).resolves.toEqual({
      outcome: 'deferred',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
