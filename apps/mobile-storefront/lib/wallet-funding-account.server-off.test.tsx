import { beforeEach, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-a' } }) },
}));

const { createWalletFundingAccount } =
  require('@/lib/wallet-funding-account') as typeof import('@/lib/wallet-funding-account');
const { clearPiggyvestPrimaryCapabilityCache } =
  require('@/lib/piggyvest-primary-capability') as typeof import('@/lib/piggyvest-primary-capability');
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  clearPiggyvestPrimaryCapabilityCache();
  mockFetchWithTimeout.mockClear();
});

// Walk 18: customers never see a provider name in an error.
it('asks for the BVN without naming the provider', async () => {
  mockFetchWithTimeout.mockResolvedValueOnce({
    ok: false,
    status: 409,
    statusText: 'Conflict',
    json: async () => ({ code: 'OWNERSHIP_REVIEW_REQUIRED' }),
  });
  const failure = await createWalletFundingAccount({ merchantId }).catch(
    (error: unknown) => error
  );
  expect(failure).toEqual(
    new Error(
      'Your BVN and consent are required for wallet setup. No bank account was created.'
    )
  );
  expect((failure as Error).message).not.toMatch(/piggyvest/i);
});
