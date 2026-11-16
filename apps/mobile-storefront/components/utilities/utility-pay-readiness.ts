/**
 * Extra scroll space under a utility form while the Pay footer shows a notice
 * above the button, so the last field is never hidden behind it. Sized for a
 * three-line message plus its link at larger text sizes; extra blank space at
 * the end of the scroll is harmless, a clipped field is not.
 */
export const UTILITY_FOOTER_NOTICE_SPACE = 120;

/** The wallet reads the Pay button needs, as the payment hook exposes them. */
export interface UtilityPayWalletSnapshot {
  canFundByBankTransfer: boolean;
  getWalletBalance: () => number;
  isAuthenticated: boolean;
  isWalletSettled: () => boolean;
  walletError: Error | null;
  walletIsLoading: boolean;
  walletIsStoreCredit?: boolean;
  walletPrimaryUnknown?: boolean;
}

/** Where the shortfall notice's link sends the customer to add money. */
export type UtilityTopUpRoute = 'store-credit' | 'bank-transfer' | 'wallet';

export interface UtilityPayShortfall {
  ctaLabel: string;
  message: string;
  route: UtilityTopUpRoute;
  /** Naira still needed (amount minus the settled balance). */
  shortfall: number;
}

interface UtilityPayShortfallInput {
  amount: number;
  payment: UtilityPayWalletSnapshot;
  /** A kept attempt for this purchase replays without a new charge. */
  retained: boolean;
  /** The PiggyVest savings wallet pays this purchase. */
  savingsCovers: boolean;
}

/**
 * Why the chosen payment method cannot pay, or null when it can (or when that
 * is not known yet). Only a settled, healthy balance that is short blocks
 * Pay: loading, failed and signed-out wallets stay pressable so the submit
 * gate can say "checking", offer Try Again or ask the customer to sign in. A
 * kept attempt replays without charging again, so it never counts as short.
 */
export function getUtilityPayShortfall({
  amount,
  payment,
  retained,
  savingsCovers,
}: UtilityPayShortfallInput): UtilityPayShortfall | null {
  if (!(amount > 0) || retained || savingsCovers) return null;
  if (
    !payment.isAuthenticated ||
    payment.walletIsLoading ||
    payment.walletError ||
    payment.walletPrimaryUnknown ||
    !payment.isWalletSettled()
  ) {
    return null;
  }
  const balance = payment.getWalletBalance();
  if (balance >= amount) return null;
  const shortfall = amount - balance;
  if (payment.walletIsStoreCredit) {
    return {
      ctaLabel: 'Add store credit',
      message: 'Not enough store credit to pay this.',
      route: 'store-credit',
      shortfall,
    };
  }
  return {
    ctaLabel: payment.canFundByBankTransfer ? 'Fund wallet' : 'Open wallet',
    message: 'Not enough in your wallet to pay this.',
    route: payment.canFundByBankTransfer ? 'bank-transfer' : 'wallet',
    shortfall,
  };
}
