import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';

const { createLivePlanWalletService } =
  require('@/lib/piggyvest/plan-wallet-live-service') as typeof import('@/lib/piggyvest/plan-wallet-live-service');

const READY_SNAPSHOT = {
  status: 'ready',
  walletId: 'pvb-wallet-synthetic-001',
  accountNumber: '9000000001',
  accountName: 'SYNTHETIC PLAN WALLET',
  bankName: 'Synthetic Bank',
  balanceKobo: 5000000,
  paidInterestKobo: 0,
  pendingAccrualKobo: 0,
};

function okResponse(json: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => json,
  };
}

describe('live plan wallet service', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'synthetic-token' } },
      error: null,
    });
  });

  it('loads the snapshot with merchant scoping', async () => {
    mockFetchWithTimeout.mockResolvedValue(okResponse(READY_SNAPSHOT));
    const service = createLivePlanWalletService({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });

    await expect(service.getSnapshot()).resolves.toEqual(READY_SNAPSHOT);
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/storefront/customer/wallet/piggyvest-plan?'
      ),
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('provisions via POST and validates the response', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      okResponse({ ...READY_SNAPSHOT, status: 'provisioning' })
    );
    const service = createLivePlanWalletService({ merchantSlug: 'ogabassey' });

    const snapshot = await service.createWallet();

    expect(snapshot.status).toBe('provisioning');
    expect(mockFetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining('/api/storefront/customer/wallet/piggyvest-plan'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('rejects malformed snapshots without partial state', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      okResponse({ ...READY_SNAPSHOT, balanceKobo: 'lots' })
    );
    const service = createLivePlanWalletService({ merchantSlug: 'ogabassey' });

    await expect(service.refresh()).rejects.toThrow(
      'Invalid plan wallet snapshot response'
    );
  });
});
