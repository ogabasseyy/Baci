import { Alert } from 'react-native';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { promptUtilityWalletFunding } from './utility-wallet-funding-prompt';
import { ensureUtilityWalletReady } from './utility-wallet-readiness';

jest.mock('./utility-wallet-funding-prompt', () => ({
  promptUtilityWalletFunding: jest.fn(),
}));

const mockPromptUtilityWalletFunding =
  promptUtilityWalletFunding as unknown as jest.Mock;

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: unknown) => mockRouterPush(route) },
}));

function paymentState(
  overrides: Record<string, unknown> = {}
): Parameters<typeof ensureUtilityWalletReady>[0]['payment'] {
  return {
    canFundByBankTransfer: true,
    isAuthenticated: true,
    refetchWallet: jest.fn(),
    walletBalance: 5000,
    walletError: null,
    walletIsLoading: false,
    ...overrides,
  };
}

describe('ensureUtilityWalletReady', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns true when the settled wallet covers the amount', () => {
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState(),
    });

    expect(ready).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('sends signed-out customers to sign in instead of the funding prompt', () => {
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({ isAuthenticated: false, walletBalance: 0 }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Sign in required',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: 'Sign In' })])
    );
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    buttons.find((button) => button.text === 'Sign In')?.onPress?.();
    expect(mockRouterPush).toHaveBeenCalledWith('/auth/login');
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('asks loading wallets to wait instead of reporting a shortfall', () => {
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({ walletBalance: 0, walletIsLoading: true }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checking wallet balance',
      expect.any(String)
    );
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('offers a wallet refetch from the error state instead of reporting a shortfall', () => {
    const refetchWallet = jest.fn();
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        refetchWallet,
        walletBalance: 0,
        walletError: new Error('wallet unavailable'),
      }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Wallet unavailable',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: 'Try Again' })])
    );
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
      text: string;
      onPress?: () => void;
    }>;
    buttons.find((button) => button.text === 'Try Again')?.onPress?.();
    expect(refetchWallet).toHaveBeenCalledTimes(1);
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('prompts funding with eligibility when the settled balance is short', () => {
    const returnToHref = '/utilities/airtime' as WalletReturnHref;
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        canFundByBankTransfer: false,
        walletBalance: 200,
      }),
      returnToHref,
    });

    expect(ready).toBe(false);
    expect(mockPromptUtilityWalletFunding).toHaveBeenCalledWith({
      amount: 1000,
      balance: 200,
      canFundByBankTransfer: false,
      returnToHref,
    });
  });
});
