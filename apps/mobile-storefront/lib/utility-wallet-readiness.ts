import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { WalletReturnHref } from './sanitize-wallet-return-to';
import { promptUtilityWalletFunding } from './utility-wallet-funding-prompt';

interface UtilityWalletReadinessPayment {
  canFundByBankTransfer: boolean;
  walletBalance: number;
  walletError: Error | null;
  walletIsLoading: boolean;
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
  customer,
  payment,
  returnToHref,
}: {
  amount: number;
  customer: unknown;
  payment: UtilityWalletReadinessPayment;
  returnToHref?: WalletReturnHref | null;
}): boolean {
  if (!customer) {
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
  if (payment.walletIsLoading) {
    Alert.alert(
      'Checking wallet balance',
      'Please wait a moment and try again.'
    );
    return false;
  }
  if (payment.walletError) {
    Alert.alert(
      'Wallet unavailable',
      "We couldn't load your wallet balance. Please try again."
    );
    return false;
  }
  if (payment.walletBalance < amount) {
    promptUtilityWalletFunding({
      amount,
      balance: payment.walletBalance,
      canFundByBankTransfer: payment.canFundByBankTransfer,
      returnToHref,
    });
    return false;
  }
  return true;
}
