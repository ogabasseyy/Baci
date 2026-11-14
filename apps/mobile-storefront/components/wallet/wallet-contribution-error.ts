import { customerErrorText } from '@/lib/customer-error-text';
import { notifySavings, type SavingsNotify } from './savings/savings-notice';
import { getErrorCode } from './savings/stored-contribution-operation';
import { shouldReportContributionFailure } from './wallet-contribution-failure';

/**
 * Tells the customer why a wallet contribution failed. Insufficient funds
 * moved nothing, so the stored operation id stays valid; a closed PIN sheet
 * is silent; a server refusal is reported with its message, and a transport
 * failure (outcome unknown) says it is still being confirmed.
 */
export function reportContributionError(
  error: unknown,
  releaseOperation?: () => void,
  /** The caller's notifier, bound to the account the action started for. */
  notify: SavingsNotify = notifySavings
): void {
  if (getErrorCode(error) === 'INSUFFICIENT_FUNDS') {
    notify(
      'Not enough money in your wallet',
      'Add money to your wallet, then try again.',
      'warning'
    );
    return;
  }
  if (!shouldReportContributionFailure(error, releaseOperation)) return;
  const worded = customerErrorText(error, '');
  if (!worded) {
    // A timeout or lost connection: the contribution may still go through,
    // so never say "try again" beside the card that says not to pay again.
    notify(
      'Still confirming your savings',
      UNCONFIRMED_CONTRIBUTION_MESSAGE,
      'warning'
    );
    return;
  }
  notify('Unable to add savings', worded, 'warning');
}

/** Shown when a contribution's outcome is unknown (timeout, no connection). */
export const UNCONFIRMED_CONTRIBUTION_MESSAGE =
  "We couldn't confirm this contribution yet. Check again in a moment before adding more.";
