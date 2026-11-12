import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { type WalletQueryData, walletKeys } from '@/hooks/wallet-query';
import { createLiveWalletQuery } from './live-wallet-query';

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return {
    useAuthStore: create(() => ({
      customer: { id: 'customer-1', email: 'customer@example.com' },
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    })),
  };
});

// With the server keeping PiggyVest off the wallet has no PiggyVest
// balance, so the live verdict leaves every purchase screen unchanged.
describe('createLiveWalletQuery (server off)', () => {
  it('reports no PiggyVest verdict for a plain wallet', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData<WalletQueryData>(
      walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'customer-1',
        userId: 'user-1',
      }),
      { wallet: { balance: 1200, loyalty_points: 0 }, transactions: [] }
    );
    const live = createLiveWalletQuery(queryClient);

    expect(live.getBalance()).toBe(1200);
    expect(live.getVerdict()).toEqual({
      walletIsStoreCredit: false,
      walletPrimaryUnknown: false,
    });
    queryClient.clear();
  });
});
