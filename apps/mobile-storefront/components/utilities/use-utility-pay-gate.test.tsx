import { act, renderHook } from '@testing-library/react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useUtilityPayGate } from './use-utility-pay-gate';
import type { UtilityPayWalletSnapshot } from './utility-pay-readiness';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockRouterPush(route) },
}));

const RETURN_TO = '/utilities/airtime?repeatAmount=100' as WalletReturnHref;
const storeCredit: UtilityPayWalletSnapshot = {
  canFundByBankTransfer: false,
  getWalletBalance: () => 0,
  isAuthenticated: true,
  isWalletSettled: () => true,
  walletError: null,
  walletIsLoading: false,
  walletIsStoreCredit: true,
};

describe('useUtilityPayGate for a PiggyVest customer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useVtuWalletPayStore.setState({ covers: () => false });
  });

  // The walk: ₦100 chosen, ₦0 store credit, Pay stayed red and enabled.
  it('blocks ₦100 with ₦0 store credit and links to a store credit top-up', () => {
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 100,
        formIssue: null,
        payment: storeCredit,
        retained: false,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current.blockedReason).toBe(
      'Not enough store credit to pay this.'
    );
    expect(result.current.action?.label).toBe('Add store credit');
    act(() => result.current.action?.onPress());
    // The card top-up minimum is prefilled, never the bare ₦100 shortfall.
    expect(mockRouterPush).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/wallet\?action=fund&requiredAmount=\d+&returnTo=/
      )
    );
  });

  it('lets the savings wallet pay when the host says it covers the amount', () => {
    useVtuWalletPayStore.setState({ covers: (amount) => amount <= 5000 });
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 100,
        formIssue: null,
        payment: storeCredit,
        retained: false,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current.blockedReason).toBeNull();
  });
});
