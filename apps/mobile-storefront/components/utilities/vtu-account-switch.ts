import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';

type PaymentState = ReturnType<typeof useUtilityPayment>;

/**
 * Discards a settled wallet checkout when the signed-in account
 * switched (or signed out) mid-flight. The wallet + screen now belong
 * to someone else, so the result must not drive their success screen
 * or balance display. Returns true when the caller must drop the
 * result; alerts once so the switch is visible, mirroring web's
 * `latestIdentityRef` guard in `use-utility-purchase`. Also invalidates
 * cached wallets: the debit may have landed, and without this,
 * switching back within the stale window would serve the cached
 * pre-debit balance.
 */
export function shouldDiscardVtuResultForAccountSwitch(
  payment: PaymentState,
  submittingOwner: string | undefined
): boolean {
  if (payment.isSubmittingOwnerCurrent(submittingOwner)) {
    return false;
  }
  payment.invalidateWallets();
  Alert.alert(
    'Account Changed',
    'The signed-in account changed while the purchase was processing. The result was discarded.'
  );
  return true;
}
