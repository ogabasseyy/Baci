import { router } from 'expo-router';
import { Alert } from 'react-native';
import { navigateToWalletFunding } from './navigate-to-wallet-funding';
import type { WalletReturnHref } from './sanitize-wallet-return-to';

/**
 * Wallet-only utility checkout: when the balance cannot cover the bill there
 * is no card fallback — the customer must fund first. Shows an alert that
 * deep-links into wallet funding (round-tripping back to the prefilled
 * purchase form) or lets them cancel.
 *
 * The funding action follows DVA eligibility: the bank-transfer deep link
 * only exists when the merchant has wallet DVAs enabled. Otherwise the
 * alert routes to the plain wallet screen, whose fund panel (card top-up)
 * works without a DVA — never a provisioning dead end. Callers must gate
 * signed-out customers before invoking this: there is no wallet to fund
 * without a session.
 */
export function promptUtilityWalletFunding({
  amount,
  balance,
  canFundByBankTransfer,
  returnToHref,
}: {
  amount: number;
  balance: number;
  canFundByBankTransfer: boolean;
  returnToHref?: WalletReturnHref | null;
}): void {
  const shortfall = Math.max(amount - balance, 0);
  const message =
    `This purchase costs ₦${amount.toLocaleString()} but your wallet ` +
    `holds ₦${balance.toLocaleString()}. ` +
    `You need ₦${shortfall.toLocaleString()} more to complete this purchase.`;
  if (!canFundByBankTransfer) {
    Alert.alert('Fund Your Wallet', message, [
      {
        text: 'Open Wallet',
        onPress: () => router.push({ pathname: '/wallet' }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
    return;
  }
  Alert.alert('Fund Your Wallet', message, [
    {
      text: 'Fund Wallet',
      onPress: () => navigateToWalletFunding(returnToHref),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
