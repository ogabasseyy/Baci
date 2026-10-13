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
 * pre-debit balance. When `getIsActive` reports off-screen, the alert
 * is suppressed (no UI over the destination screen) but wallets are
 * still invalidated and the result still discarded (Codex R37 rktSh).
 */
export function shouldDiscardVtuResultForAccountSwitch(
  payment: PaymentState,
  submittingOwner: string | undefined,
  getIsActive?: () => boolean
): boolean {
  if (payment.isSubmittingOwnerCurrent(submittingOwner)) {
    return false;
  }
  payment.invalidateWallets();
  if (!getIsActive || getIsActive()) {
    Alert.alert(
      'Account Changed',
      'The signed-in account changed while the purchase was processing. The result was discarded.'
    );
  }
  return true;
}

/**
 * Refreshes the wallet after a suppressed VTU result (account
 * switch, off-screen settle, or off-screen ambiguous error)
 * without ever failing the purchase or surfacing UI. The outcome
 * is settled-or-ambiguous and the registry already holds it for
 * switch-back replay, so a refetch rejection must degrade to a
 * stale balance — the pre-refetch status quo — never propagate
 * into the handler's outer catch (which would flip a recorded
 * success into `Payment Failed`, or Alert over the destination
 * screen for an off-screen error). Still awaited: on success the
 * next readiness check is fresh. `payment.refetchWallet` already
 * swallows query errors, but the suppressed path must not depend
 * on that implementation detail.
 */
export async function refreshWalletAfterSuppressedVtuResult(payment: {
  refetchWallet: () => Promise<unknown>;
}): Promise<void> {
  try {
    await payment.refetchWallet();
  } catch {
    // Swallowed by design (see docblock): the suppressed UI has
    // nothing to report to, and the committed outcome stands.
  }
}
