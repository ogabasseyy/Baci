import { Alert } from 'react-native';
import { navigateToStoreCreditTopUp } from './navigate-to-store-credit-top-up';
import type { WalletReturnHref } from './sanitize-wallet-return-to';
import { WALLET_TOP_UP_MIN_AMOUNT } from './wallet-top-up-constants';

export interface PiggyvestShortfallVerdict {
  /** PiggyVest customer: utilities spend store credit (the older wallet). */
  walletIsStoreCredit?: boolean;
  /** PiggyVest check failed: we can't tell which wallet would be funded. */
  walletPrimaryUnknown?: boolean;
}

/**
 * Handles a utility shortfall for PiggyVest-aware wallets. Returns false
 * when neither verdict applies, so callers fall through to today's
 * funding prompt. A bank transfer would land in the PiggyVest savings
 * wallet, which can't pay yet, so store credit is added by card only.
 */
export function promptPiggyvestUtilityShortfall({
  amount,
  balance,
  refetchWallet,
  returnToHref,
  verdict,
}: {
  amount: number;
  balance: number;
  refetchWallet: () => void;
  returnToHref?: WalletReturnHref | null;
  verdict: PiggyvestShortfallVerdict;
}): boolean {
  if (verdict.walletIsStoreCredit) {
    const shortfall = Math.max(amount - balance, 0);
    // Card top-ups have a minimum, so quote what the sheet will prefill.
    const topUp = Math.max(WALLET_TOP_UP_MIN_AMOUNT, Math.ceil(shortfall));
    const message =
      `This costs ₦${amount.toLocaleString()} and you have ` +
      `₦${balance.toLocaleString()} store credit. Your savings wallet ` +
      `can’t pay for this yet, so add ₦${topUp.toLocaleString()} ` +
      'store credit by card.';
    Alert.alert(
      'Not enough store credit',
      message,
      returnToHref
        ? [
            {
              text: 'Add store credit',
              onPress: () =>
                navigateToStoreCreditTopUp(shortfall, returnToHref),
            },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [{ text: 'OK', style: 'cancel' }]
    );
    return true;
  }
  if (verdict.walletPrimaryUnknown) {
    // A card top-up only ever adds store credit, which this purchase
    // spends, so it is safe while the wallet kind is unknown or pending;
    // bank transfer stays held. Try again re-checks the wallet.
    const shortfall = Math.max(amount - balance, 0);
    Alert.alert(
      'Wallet not ready',
      "We couldn't confirm your wallet yet. Add store credit by card, or try again.",
      [
        ...(returnToHref
          ? [
              {
                text: 'Add store credit',
                onPress: () =>
                  navigateToStoreCreditTopUp(shortfall, returnToHref),
              },
            ]
          : []),
        { text: 'Try Again', onPress: () => refetchWallet() },
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
    return true;
  }
  return false;
}
