import { beforeEach, expect, it } from '@jest/globals';
import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';

let mockAuthUserId: string | null = null;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => ({ user: mockAuthUserId ? { id: mockAuthUserId } : null }),
  },
}));

const { createWalletFundingAccount } =
  require('@/lib/wallet-funding-account') as typeof import('@/lib/wallet-funding-account');
const { clearPiggyvestPrimaryCapabilityCache } =
  require('@/lib/piggyvest-primary-capability') as typeof import('@/lib/piggyvest-primary-capability');
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  mockAuthUserId = 'user-a';
  clearPiggyvestPrimaryCapabilityCache();
  mockFetchWithTimeout.mockClear();
});

it.each([
  'OWNERSHIP_REVIEW_REQUIRED',
  'INTEREST_ROUTING_REVIEW_REQUIRED',
])('does not use legacy funding after %s', async (code) => {
  mockFetchWithTimeout.mockResolvedValueOnce({
    ok: false,
    status: 409,
    statusText: 'Conflict',
    json: async () => ({
      code,
      error: 'untrusted server-provided message',
    }),
  });

  await expect(createWalletFundingAccount({ merchantId })).rejects.toThrow(
    'Your BVN and consent are required'
  );

  expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
  expect(mockFetchWithTimeout).toHaveBeenCalledWith(
    expect.stringContaining(
      '/api/storefront/customer/wallet/piggyvest-primary'
    ),
    expect.objectContaining({ method: 'GET' })
  );
});
