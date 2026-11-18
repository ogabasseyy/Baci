import { act, renderHook } from '@testing-library/react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useUtilityPayGate } from './use-utility-pay-gate';
import type { UtilityPayWalletSnapshot } from './utility-pay-readiness';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockRouterPush(route) },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'intent-1' }));
jest.mock('@/constants/wallet-funding', () => ({
  WALLET_FUNDING_CHECKING_STATE_ENABLED: false,
}));

const RETURN_TO = '/utilities/airtime?repeatAmount=500' as WalletReturnHref;

function wallet(
  balance: number,
  canFundByBankTransfer = false
): UtilityPayWalletSnapshot {
  return {
    canFundByBankTransfer,
    getWalletBalance: () => balance,
    isAuthenticated: true,
    isWalletSettled: () => true,
    walletError: null,
    walletIsLoading: false,
  };
}

// With the server keeping PiggyVest off no host installs `covers`, so the
// savings wallet never pays and the plain wallet decides.
describe('useUtilityPayGate with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useVtuWalletPayStore.setState({ covers: () => false });
  });

  it('lets a complete form pay from a wallet that covers it', () => {
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 500,
        formIssue: null,
        payment: wallet(1000),
        retained: false,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current).toEqual({ action: null, blockedReason: null });
  });

  it('puts the form issue first', () => {
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 500,
        formIssue: 'Enter the phone number to top up.',
        payment: wallet(0),
        retained: false,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current).toEqual({
      action: null,
      blockedReason: 'Enter the phone number to top up.',
    });
  });

  it('blocks a short wallet and its link opens bank-transfer funding', () => {
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 500,
        formIssue: null,
        payment: wallet(100, true),
        retained: false,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current.blockedReason).toBe(
      'Not enough in your wallet to pay this.'
    );
    act(() => result.current.action?.onPress());
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/wallet',
      params: { action: 'bank-transfer' },
    });
  });

  it('opens the wallet when bank transfer is not offered', () => {
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 500,
        formIssue: null,
        payment: wallet(0),
        retained: false,
        returnToHref: RETURN_TO,
      })
    );

    act(() => result.current.action?.onPress());
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/wallet' });
  });

  it('never blocks a kept attempt', () => {
    const { result } = renderHook(() =>
      useUtilityPayGate({
        amount: 500,
        formIssue: null,
        payment: wallet(0),
        retained: true,
        returnToHref: RETURN_TO,
      })
    );

    expect(result.current.blockedReason).toBeNull();
  });
});
