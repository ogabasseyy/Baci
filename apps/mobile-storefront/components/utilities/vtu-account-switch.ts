import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { getPendingVtuSettlementPass } from '@/hooks/use-vtu-retained-settlement';
import {
  markPendingVtuCompleted,
  notePendingVtuReference,
} from '@/lib/pending-vtu-idempotency';

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
/**
 * Settle-then-submit gate with post-gate owner re-check. Returns true
 * when the submit may proceed; false when it must stop (screen popped
 * mid-gate, or the account switched while the pass was pending).
 *
 * The pass can take seconds (R60), and an account switch landing in
 * that window would otherwise let the continuation persist or recall
 * a key for the previous owner before token binding rejects the live
 * replacement session (Codex R103 P2). The owner is captured before
 * the await and compared against the live store after — the same
 * fence as the post-dispatch guard below, but pre-submit, so there
 * is no key to finalize on a stop. Shared by the airtime, data, and
 * bill handlers so the gate cannot drift between them.
 */
export async function awaitUtilitySettlementGate({
  getIsActive,
  payment,
}: {
  getIsActive?: () => boolean;
  payment: Pick<
    PaymentState,
    'captureSubmittingOwner' | 'isSubmittingOwnerCurrent'
  >;
}): Promise<boolean> {
  const settlementPass = getPendingVtuSettlementPass();
  if (!settlementPass) {
    return true;
  }
  const preGateOwner = payment.captureSubmittingOwner();
  await settlementPass;
  // R73: popped during the gate — never submit into an abandoned
  // view. No-pass submits stay synchronous from the tap.
  if (getIsActive && !getIsActive()) {
    return false;
  }
  if (!payment.isSubmittingOwnerCurrent(preGateOwner)) {
    Alert.alert(
      'Account Changed',
      'The signed-in account changed while the purchase was starting. Please try again.'
    );
    return false;
  }
  return true;
}

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

/**
 * Preserves a committed outcome whose UI is suppressed (account
 * switch or back-navigation mid-flight). Notes the reference so a
 * switch-back repeat replays instead of minting fresh and debiting
 * twice; records completion for terminal observations (processing
 * notes must NOT — the stale guard keys off completion time); and
 * refreshes the wallet (never-fails) since the suppressed onSuccess
 * will never fire the parent's invalidation. Shared by the airtime
 * and bill handlers (Codex R62 6rtokS/6rtokY).
 */
export async function preserveSuppressedVtuSuccess(
  payment: PaymentState,
  descriptor: string,
  result: { reference: string; status: string }
): Promise<void> {
  notePendingVtuReference(descriptor, result.reference);
  if (result.status !== 'processing') {
    markPendingVtuCompleted(descriptor);
  }
  await refreshWalletAfterSuppressedVtuResult(payment);
}
