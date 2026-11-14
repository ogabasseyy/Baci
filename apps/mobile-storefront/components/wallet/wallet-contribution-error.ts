import { customerErrorText } from '@/lib/customer-error-text';
import { notifySavings, type SavingsNotify } from './savings/savings-notice';
import { getErrorCode } from './savings/stored-contribution-operation';
import { shouldReportContributionFailure } from './wallet-contribution-failure';

/**
 * Tells the customer why a wallet contribution failed. Insufficient funds
 * moved nothing, so the stored operation id stays valid; a closed PIN sheet
 * is silent; every other failure is reported with its message.
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
  notify(
    'Unable to add savings',
    customerErrorText(error, 'Please try again in a moment.'),
    'warning'
  );
}
