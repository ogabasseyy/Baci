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
    captureSubmittingUserId: () => 'user-1',
    isAuthenticated: true,
    refetchWallet: jest.fn(),
    getWalletBalance: () => 5000,
    walletError: null,
    walletIsLoading: false,
    isWalletRefetching: () => false,
    isWalletSettled: () => true,
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

  it('lets retained replays bypass the balance gate', () => {
    // Codex R65 6ru4mK: the wallet was already debited for this
    // exact intent — a post-debit balance dip must not strand
    // recovery behind top-up.
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      isRetainedReplay: true,
      payment: paymentState({ getWalletBalance: () => 0 }),
    });

    expect(ready).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('still gates fresh purchases on balance', () => {
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({ getWalletBalance: () => 0 }),
    });

    expect(ready).toBe(false);
    expect(mockPromptUtilityWalletFunding).toHaveBeenCalledTimes(1);
  });

  it('sends signed-out customers to sign in instead of the funding prompt', () => {
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        isAuthenticated: false,
        getWalletBalance: () => 0,
      }),
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
      payment: paymentState({
        getWalletBalance: () => 0,
        walletIsLoading: true,
      }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checking wallet balance',
      expect.any(String)
    );
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('blocks while a wallet refetch is in flight even when loading is false', () => {
    // Muse follow-up: isLoading is false during background refetches,
    // so gate on the live fetch reader too — the cached balance is
    // about to be replaced. Mirrors web's walletRefreshPending check.
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        getWalletBalance: () => 5000,
        walletIsLoading: false,
        isWalletRefetching: () => true,
      }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checking wallet balance',
      expect.any(String)
    );
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('re-reads refetch state on every evaluation instead of snapshotting it', () => {
    // Codex R75 6r486a: the payment object is captured BEFORE the
    // settlement-gate await; a refetch starting during that await
    // must still block. A render-time boolean would stay false here.
    let refetching = false;
    const payment = paymentState({
      getWalletBalance: () => 5000,
      walletIsLoading: false,
      isWalletRefetching: () => refetching,
    });

    expect(ensureUtilityWalletReady({ amount: 1000, payment })).toBe(true);
    refetching = true;
    expect(ensureUtilityWalletReady({ amount: 1000, payment })).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checking wallet balance',
      expect.any(String)
    );
  });

  it('re-reads the balance on every evaluation instead of snapshotting it', () => {
    // Codex R78 6sN80p: a refetch completing during the
    // settlement-gate await refreshes the cache while the purchase
    // closure still holds the old number — the gate must admit the
    // refreshed verdict. A snapshot would stay blocked here.
    let balance = 0;
    const payment = paymentState({
      getWalletBalance: () => balance,
      walletIsLoading: false,
    });

    expect(ensureUtilityWalletReady({ amount: 1000, payment })).toBe(false);
    balance = 5000;
    expect(ensureUtilityWalletReady({ amount: 1000, payment })).toBe(true);
  });

  it('blocks retained replays while a wallet refetch is in flight', () => {
    // The R65 bypass skips the balance comparison, not the loading
    // gates: a replay must still wait for fresh balance evidence.
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      isRetainedReplay: true,
      payment: paymentState({
        getWalletBalance: () => 0,
        walletIsLoading: false,
        isWalletRefetching: () => true,
      }),
    });

    expect(ready).toBe(false);
  });

  it('offers a wallet refetch from the error state instead of reporting a shortfall', () => {
    const refetchWallet = jest.fn();
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        refetchWallet,
        getWalletBalance: () => 0,
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
        getWalletBalance: () => 200,
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

  it('asks unsettled wallets to wait instead of reporting a shortfall', () => {
    // Muse R2 medium: a DISABLED query (identity mid-switch, owner
    // unresolved) is not loading, not refetching, and error-free —
    // but has no data, so the balance reads 0. A funded customer
    // must see "checking balance", not the funding prompt, and the
    // gate must not even read the meaningless zero.
    const getWalletBalance = jest.fn(() => 0);
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        getWalletBalance,
        walletIsLoading: false,
        isWalletRefetching: () => false,
        isWalletSettled: () => false,
      }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checking wallet balance',
      expect.any(String)
    );
    expect(getWalletBalance).not.toHaveBeenCalled();
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });

  it('re-reads settled state on every evaluation instead of snapshotting it', () => {
    // The payment object is captured BEFORE the settlement-gate
    // await; an identity switch settling during that await must
    // flip the verdict. A render-time boolean would stay true here.
    let settled = true;
    const payment = paymentState({
      getWalletBalance: () => 5000,
      walletIsLoading: false,
      isWalletSettled: () => settled,
    });

    expect(ensureUtilityWalletReady({ amount: 1000, payment })).toBe(true);
    settled = false;
    expect(ensureUtilityWalletReady({ amount: 1000, payment })).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Checking wallet balance',
      expect.any(String)
    );
  });

  it('waits for the submitting user id instead of failing post-dispatch', () => {
    // Muse R2 low: session present but the user object still
    // hydrating — the charge's submitter binding would abort with
    // "Account still loading" AFTER dispatch. Gate pre-submit.
    const ready = ensureUtilityWalletReady({
      amount: 1000,
      payment: paymentState({
        captureSubmittingUserId: () => undefined,
        getWalletBalance: () => 5000,
        isAuthenticated: true,
      }),
    });

    expect(ready).toBe(false);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Account still loading',
      expect.any(String)
    );
    expect(mockPromptUtilityWalletFunding).not.toHaveBeenCalled();
  });
});
