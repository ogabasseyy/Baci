let mockFlagEnabled = false;

jest.mock('@/constants/wallet-funding', () => ({
  get WALLET_FUNDING_CHECKING_STATE_ENABLED() {
    return mockFlagEnabled;
  },
}));

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockRouterPush(route) },
}));

let mockNextUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `intent-${++mockNextUuid}`,
}));

import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { navigateToWalletFunding } from './navigate-to-wallet-funding';

const RETURN_TO =
  '/utilities/airtime?repeatAmount=1000&repeatPhoneNumber=08012345678' as WalletReturnHref;

describe('navigateToWalletFunding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlagEnabled = false;
    mockNextUuid = 0;
  });

  it('opens the wallet bank-transfer flow with no return route by default', () => {
    navigateToWalletFunding(RETURN_TO);

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'bank-transfer' },
    });
  });

  it('threads the return link plus a fresh intent when the checking-state flag is on', () => {
    mockFlagEnabled = true;

    navigateToWalletFunding(RETURN_TO);

    expect(mockRouterPush).toHaveBeenCalledWith(
      `/wallet?action=bank-transfer&intent=intent-1&returnTo=${encodeURIComponent(RETURN_TO)}`
    );
  });

  it('mints a fresh intent per call so retries never share a funding session', () => {
    mockFlagEnabled = true;

    navigateToWalletFunding(RETURN_TO);
    navigateToWalletFunding(RETURN_TO);

    expect(mockRouterPush).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('intent=intent-1')
    );
    expect(mockRouterPush).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('intent=intent-2')
    );
  });

  it('omits the return link when none is provided even with the flag on', () => {
    mockFlagEnabled = true;

    navigateToWalletFunding(undefined);

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'bank-transfer' },
    });
  });
});
