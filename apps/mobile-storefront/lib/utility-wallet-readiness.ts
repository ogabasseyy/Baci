import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { WalletReturnHref } from './sanitize-wallet-return-to';
import { promptUtilityWalletFunding } from './utility-wallet-funding-prompt';

interface UtilityWalletReadinessPayment {
  canFundByBankTransfer: boolean;
  /**
   * Raw session presence — NOT customer-record presence. Startup publishes
   * session/user with customer:null while hydration finishes in the
   * background, and the wallet still resolves by user ID, so gating on the
   * customer record would send signed-in customers to sign in again.
   */
  isAuthenticated: boolean;
  refetchWallet: () => void;
  /**
   * Live wallet-balance reader (Codex R78 6sN80p), invoked at gate
   * time — NOT a render-time snapshot. A refetch completing during
   * the settlement-gate await refreshes the cache while the purchase
   * closure still holds the old number; reading live admits the
   * refreshed verdict instead.
   */
  getWalletBalance: () => number;
  walletError: Error | null;
  walletIsLoading: boolean;
  /**
   * Live wallet-fetch reader (Codex R75 6r486a), invoked at gate
   * time — NOT a render-time snapshot. The payment object is
   * captured before the settlement-gate await; a refetch starting
   * during that await must still block. Mirrors web's
   * walletRefreshPending live read.
   */
  isWalletRefetching: () => boolean;
}

/**
 * Shared pre-submit gate for wallet-only utility purchases (airtime, data,
 * bills). A zero balance is ambiguous — it also reads while the wallet query
 * is loading or after it errors — so each state gets its own verdict instead
 * of every short read opening the funding prompt. Signed-out customers have
 * no wallet at all and are sent to sign in. Returns true only when the wallet
 * is settled, healthy, and covers the amount.
 */
export function ensureUtilityWalletReady({
  amount,
  isRetainedReplay = false,
  payment,
  returnToHref,
}: {
  amount: number;
  /**
   * Retained replays bypass the balance gate (Codex R65 6ru4mK):
   * the wallet was already debited for this exact intent — the
   * server replays the original outcome without charging again,
   * so a post-debit balance dip must not strand recovery behind
   * top-up. Auth/loading/error gates still apply.
   */
  isRetainedReplay?: boolean;
  payment: UtilityWalletReadinessPayment;
  returnToHref?: WalletReturnHref | null;
}): boolean {
  if (!payment.isAuthenticated) {
    Alert.alert(
      'Sign in required',
      'Please sign in to buy utilities from your wallet.',
      [
        {
          text: 'Sign In',
          onPress: () => router.push('/auth/login'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
    return false;
  }
  // A refetch in flight means fresh data is seconds away — never
  // submit against the balance it is about to replace. Merely stale
  // data with no fetch running still stands (the server stays
  // authoritative); blocking on that would brick purchases.
  if (payment.walletIsLoading || payment.isWalletRefetching()) {
    Alert.alert(
      'Checking wallet balance',
      'Please wait a moment and try again.'
    );
    return false;
  }
  if (payment.walletError) {
    Alert.alert('Wallet unavailable', "We couldn't load your wallet balance.", [
      {
        text: 'Try Again',
        onPress: () => payment.refetchWallet(),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
    return false;
  }
  // Read the balance at gate time, not from the pre-await snapshot.
  const walletBalance = payment.getWalletBalance();
  if (!isRetainedReplay && walletBalance < amount) {
    promptUtilityWalletFunding({
      amount,
      balance: walletBalance,
      canFundByBankTransfer: payment.canFundByBankTransfer,
      returnToHref,
    });
    return false;
  }
  return true;
}
