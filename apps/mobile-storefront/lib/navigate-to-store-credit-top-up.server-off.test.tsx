import { describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { navigateToStoreCreditTopUp } from './navigate-to-store-credit-top-up';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// Pure navigation: no server call is made, so it works with the server off.
describe('navigateToStoreCreditTopUp with the server off', () => {
  it('opens the card top-up with the shortfall rounded up and a return link', () => {
    navigateToStoreCreditTopUp(
      499.2,
      '/utilities/airtime?repeatAmount=500' as WalletReturnHref
    );

    expect(router.push).toHaveBeenCalledWith(
      '/wallet?action=fund&requiredAmount=500&returnTo=%2Futilities%2Fairtime%3FrepeatAmount%3D500'
    );
  });
});
