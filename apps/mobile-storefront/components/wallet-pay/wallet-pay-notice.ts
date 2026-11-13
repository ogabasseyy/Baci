import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type {
  WalletPayFailedReason,
  WalletPayOutcome,
  WalletPayOutcomeKind,
} from './wallet-pay.types';

// The only extra failure wording the card can show (app copy, never server).
const FAILED_REASONS: Record<WalletPayFailedReason, string> = {
  imei_mismatch:
    'This IMEI does not match the check you started. Nothing more was taken.',
  check_details:
    "We couldn't start this purchase. Check the number and amount, then try again. Nothing was taken from your savings wallet.",
  price_changed:
    'The price of this check has changed. Close this and start the check again to see the new price. Nothing was taken from your savings wallet.',
};

export type WalletPayNoticeTone = 'success' | 'info' | 'warning';

export type WalletPayNotice = {
  title: string;
  message: string;
  tone: WalletPayNoticeTone;
  /** A follow-up the sheet offers besides "Done". */
  action: 'check_again' | 'try_again' | 'open_wallet' | 'sign_in' | null;
};

const amountText = (amountKobo: number | null) =>
  amountKobo === null ? 'your payment' : formatNgnCurrency(amountKobo / 100);

/**
 * Calm wording for every way a wallet payment can end (no iOS alerts). Only
 * a definite answer says money did not move; anything unknown keeps checking.
 */
export function walletPayNotice(
  outcome: WalletPayOutcome,
  amountKobo: number | null,
  purchase: string
): WalletPayNotice {
  const amount = amountText(amountKobo);
  const notices: Record<WalletPayOutcomeKind, WalletPayNotice> = {
    pending: {
      title: 'Confirming your payment',
      message: `We're still confirming ${amount}. We will finish your ${purchase} as soon as it lands. Please don't pay again.`,
      tone: 'info',
      action: 'check_again',
    },
    review: {
      title: 'Payment under review',
      message: `We're checking ${amount}. Nothing more will be taken, and if your ${purchase} can't be completed the money comes back to your savings wallet.`,
      tone: 'info',
      action: 'check_again',
    },
    refunded: {
      title: 'Refunded to your savings wallet',
      message: `Your ${purchase} could not be completed, so ${amount} is going back to your savings wallet. It is refunded exactly once, automatically; there is nothing you need to do.`,
      tone: 'warning',
      action: null,
    },
    insufficient: {
      title: 'Not enough in your savings wallet',
      message: `Your savings wallet can't cover ${amount} right now. Nothing was taken.`,
      tone: 'warning',
      action: 'open_wallet',
    },
    not_completed: {
      title: 'Payment did not go through',
      message: 'Nothing was taken from your savings wallet. Please try again.',
      tone: 'warning',
      action: null,
    },
    unavailable: {
      title: 'Savings wallet payments are paused',
      message:
        'Paying from your savings wallet is not available right now. Nothing was taken.',
      tone: 'info',
      action: null,
    },
    pin_locked: {
      title: 'PIN locked for now',
      message:
        'Too many wrong PINs. Nothing was taken. Please try again later.',
      tone: 'warning',
      action: null,
    },
    pin_setup: {
      title: 'Set up your wallet PIN first',
      message:
        'Create or reset your wallet PIN in your wallet, then come back to pay. Nothing was taken.',
      tone: 'info',
      action: 'open_wallet',
    },
    sign_in: {
      title: 'Please sign in again',
      message: 'Your session ended. Nothing was taken.',
      tone: 'info',
      action: 'sign_in',
    },
    not_started: {
      title: "We couldn't start this purchase",
      message: 'Nothing was taken from your savings wallet. Please try again.',
      tone: 'info',
      action: 'try_again',
    },
    failed: {
      title: "Payment didn't go through",
      message: 'Nothing was taken from your savings wallet.',
      tone: 'warning',
      action: null,
    },
  };
  // A refusal after the payment may have been sent: never "nothing taken".
  const maybePaid: Partial<Record<WalletPayOutcomeKind, WalletPayNotice>> = {
    sign_in: {
      ...notices.sign_in,
      message: `Your session ended. If ${amount} was already taken, your ${purchase} will finish or the money comes back automatically. Please don't pay again.`,
    },
    not_started: {
      ...notices.not_started,
      message: `If ${amount} was already taken, your ${purchase} will finish or the money comes back automatically. Please don't pay again. Try again to check.`,
    },
    unavailable: {
      title: "Can't check this payment right now",
      message: `If ${amount} was already taken, your ${purchase} will finish or the money comes back automatically. Please don't pay again.`,
      tone: 'info',
      action: 'check_again',
    },
  };
  const notice =
    (outcome.maybePaid ? maybePaid[outcome.kind] : undefined) ??
    notices[outcome.kind];
  // Callers pass only the app's own wording here, never server text.
  const reason =
    outcome.kind === 'failed' && outcome.failedReason
      ? FAILED_REASONS[outcome.failedReason]
      : null;
  return reason ? { ...notice, message: reason } : notice;
}
