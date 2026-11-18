import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { WalletPinSheetBinding } from './use-wallet-pin-prompt';
import {
  WALLET_PIN_UNAVAILABLE,
  type WalletPinStep,
} from './use-wallet-pin-sheet';

/** The wallet PIN sheet's words, per step and per request. */
export const COPY: Record<
  WalletPinStep,
  { title: string; body: string; action: string }
> = {
  loading: { title: 'Wallet PIN', body: 'Checking your PIN...', action: '' },
  unavailable: {
    title: 'Wallet PIN',
    body: WALLET_PIN_UNAVAILABLE,
    action: '',
  },
  // Drawn by IdentityConfirmPanel; listed so every step has copy.
  confirm: { title: "Confirm it's you", body: '', action: '' },
  set: {
    title: 'Create your wallet PIN',
    body: "You'll use it every time you save.",
    action: 'Save PIN',
  },
  reset: {
    title: 'Reset your wallet PIN',
    body: 'Choose a new PIN to continue.',
    action: 'Reset PIN',
  },
  enter: {
    title: 'Enter your wallet PIN',
    body: 'Confirm this contribution with your PIN.',
    action: 'Confirm',
  },
  // Drawn by WalletPinWorkingStep; the body depends on the request.
  approving: { title: 'Wallet PIN', body: '', action: '' },
};

export const ENTER_BODY = {
  cancel: 'Enter your PIN to cancel this goal.',
  complete: 'Enter your PIN to complete this goal.',
} as const;

export const PIN_TOO_SHORT = 'Enter 4 to 6 digits.';

/** What a new PIN is doing while it saves and approves this request. */
export function approvingLine(request: WalletPinSheetBinding['request']) {
  if (request && 'amountKobo' in request)
    return `Saving your PIN and approving ${formatNgnCurrency(request.amountKobo / 100)}…`;
  return 'Saving your PIN…';
}

/** What the PIN is for, in a short strip under the title. */
export function contextLine(request: WalletPinSheetBinding['request']) {
  if (!request) return null;
  if ('amountKobo' in request)
    return `Adding ${formatNgnCurrency(request.amountKobo / 100)} to savings`;
  const goal = request.goalTitle?.trim() || 'this goal';
  return request.action === 'cancel'
    ? `Cancelling ${goal}`
    : `Completing ${goal}`;
}

/**
 * A new key per request (and on close) remounts the panel, so the two-step
 * choose/confirm state never carries over to the next request.
 */
export function requestKey(request: WalletPinSheetBinding['request']) {
  if (!request) return 'closed';
  const amount = 'amountKobo' in request ? request.amountKobo : '';
  return [
    request.operationId,
    request.goalId,
    request.merchantId ?? '',
    request.action ?? 'fund',
    amount,
  ].join('|');
}
