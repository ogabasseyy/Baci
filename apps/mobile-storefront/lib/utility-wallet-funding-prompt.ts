import { Alert } from 'react-native';
import { navigateToWalletFunding } from './navigate-to-wallet-funding';
import type { WalletReturnHref } from './sanitize-wallet-return-to';

/**
 * Wallet-only utility checkout: when the balance cannot cover the bill there
 * is no card fallback — the customer must fund first. Shows an alert that
 * deep-links into wallet funding (round-tripping back to the prefilled
 * purchase form) or lets them cancel.
 */
export function promptUtilityWalletFunding({
  amount,
  balance,
  returnToHref,
}: {
  amount: number;
  balance: number;
  returnToHref?: WalletReturnHref | null;
}): void {
  Alert.alert(
    'Fund Your Wallet',
    `This purchase costs ₦${amount.toLocaleString()} but your wallet holds ₦${balance.toLocaleString()}. Fund your wallet to continue.`,
    [
      {
        text: 'Fund Wallet',
        onPress: () => navigateToWalletFunding(returnToHref),
      },
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}
