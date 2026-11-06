import { Alert } from 'react-native';
import { getErrorCode } from './savings/stored-contribution-operation';
import { shouldReportContributionFailure } from './wallet-contribution-failure';

/**
 * Tells the customer why a wallet contribution failed. Insufficient funds
 * moved nothing, so the stored operation id stays valid; a closed PIN sheet
 * is silent; every other failure is reported with its message.
 */
export function reportContributionError(
  error: unknown,
  releaseOperation?: () => void
): void {
  if (getErrorCode(error) === 'INSUFFICIENT_FUNDS') {
    Alert.alert(
      'Not enough money in your wallet',
      'Add money to your wallet, then try again.'
    );
    return;
  }
  if (!shouldReportContributionFailure(error, releaseOperation)) return;
  Alert.alert(
    'Unable to add savings',
    error instanceof Error ? error.message : 'Please try again in a moment.'
  );
}
