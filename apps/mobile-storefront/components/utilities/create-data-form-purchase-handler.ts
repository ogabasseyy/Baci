import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import {
  forgetOwnPendingVtuPurchaseDurable,
  isOwnPendingVtuStaleSuccess,
  markOwnPendingVtuCompleted,
  noteOwnPendingVtuReference,
} from '@/lib/pending-vtu-generation-guards';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import {
  acquireUtilityCheckoutOrAlert,
  releaseUtilityCheckout,
} from '@/lib/utility-checkout-inflight';
import { ensureUtilityWalletReady } from '@/lib/utility-wallet-readiness';
import {
  chargeWalletForVtu,
  creditedVtuCashback,
  shouldRotateWalletIdempotencyKeyForError,
} from '@/lib/vtu-checkout';
import {
  awaitUtilitySettlementGate,
  refreshWalletAfterSuppressedVtuResult,
  shouldDiscardVtuResultForAccountSwitch,
} from './vtu-account-switch';

type PaymentState = ReturnType<typeof useUtilityPayment>;

interface DataCustomer {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface DataFormSuccessResult {
  reference: string;
  amount: number;
  customerIdentifier?: string;
  status?: 'processing' | 'successful';
  voucherPin?: string;
  cashback?: { amount: number; newBalance: number };
}

interface CreateDataFormPurchaseHandlerInput {
  customer: DataCustomer | null | undefined;
  dismissKeyboard: () => void;
  /** Screen liveness probe; when false the success is preserved, not shown. */
  getIsActive?: () => boolean;
  getIsSubmitting: () => boolean;
  payment: PaymentState;
  phoneNumber: string;
  planAmount: number;
  selectedPlan: string | null;
  selectedProvider: string | null;
  setIsSubmitting: (isSubmitting: boolean) => void;
  onSuccess: (data: DataFormSuccessResult) => void;
  returnToHref?: WalletReturnHref | null;
}

export function createDataFormPurchaseHandler({
  customer,
  dismissKeyboard,
  getIsActive,
  getIsSubmitting,
  onSuccess,
  payment,
  phoneNumber,
  planAmount,
  selectedPlan,
  selectedProvider,
  setIsSubmitting,
  returnToHref,
}: CreateDataFormPurchaseHandlerInput) {
  return async () => {
    dismissKeyboard();
    if (getIsSubmitting()) {
      return;
    }

    if (!selectedProvider || !phoneNumber || !selectedPlan) {
      Alert.alert(
        'Missing Information',
        'Please enter a phone number and choose a data bundle.'
      );
      return;
    }
    // Bug #64: Prevent submission when planAmount is 0 or not set
    if (planAmount <= 0) {
      Alert.alert(
        'Invalid Amount',
        'Please enter a valid amount before proceeding.'
      );
      return;
    }
    const customerName =
      [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
      customer?.email ||
      undefined;

    const request = {
      amount: planAmount,
      customerName,
      customerPhone: customer?.phone || undefined,
      dataPlanCode: selectedPlan,
      networkProvider: selectedProvider,
      phoneNumber,
      type: 'data' as const,
      walletAmount: planAmount,
    };
    // Submitting flips synchronously, so taps during the wait hit the
    // guard. Settle-await BEFORE the peek (R66): peeking first
    // bypasses the balance gate on entries the pass then forgets.
    setIsSubmitting(true);
    // Settle-then-submit gate (R60) BEFORE the retained peek (R66):
    // shared helper also re-checks the owner after the await
    // (Codex R103 P2).
    if (!(await awaitUtilitySettlementGate({ getIsActive, payment }))) {
      setIsSubmitting(false);
      return;
    }
    // Retained-replay peek (R65 6ru4mK): the SAME request the submit
    // signs with — a charged-but-unanswered retry must bypass the
    // balance gate instead of stranding behind top-up.
    const isRetainedReplay = payment.hasRetainedVtuAttempt(request);
    if (
      !ensureUtilityWalletReady({
        amount: planAmount,
        isRetainedReplay,
        payment,
        returnToHref,
      })
    ) {
      // Outside the try below: reset explicitly (finally can't).
      setIsSubmitting(false);
      return;
    }

    // Screen-wide guard (Codex R77 6sNGO3): per-tab refs don't see
    // sibling tabs — refuse concurrent checkouts, don't queue.
    if (!acquireUtilityCheckoutOrAlert()) {
      setIsSubmitting(false);
      return;
    }

    try {
      // Descriptor-keyed recall: a remount (Back to Home, reopen) after
      // a 202 processing or a timeout retries with the SAME key, so the
      // route dedupes instead of debiting a second transaction.
      const descriptor = payment.scopePendingVtuDescriptor(
        buildVtuPurchaseDescriptor(request)
      );
      // The pass was already awaited above the peek; the capture below
      // recalls the same post-settle state.
      const idempotencyKey = await payment.getWalletIdempotencyKey(descriptor);
      const submittingOwner = payment.captureSubmittingOwner();
      const submittingUserId = payment.captureSubmittingUserId();
      try {
        const result = await chargeWalletForVtu({
          ...request,
          expectedUserId: submittingUserId,
          idempotencyKey,
          pendingDescriptor: descriptor,
        });
        // Generation-guarded settlement (Codex R6 P1): the
        // mutations below run only while live holds ownKey.
        const ownKey = result.canonicalIdempotencyKey ?? idempotencyKey;
        if (
          shouldDiscardVtuResultForAccountSwitch(
            payment,
            submittingOwner,
            getIsActive
          )
        ) {
          // Finalize the SUBMITTER's entry (descriptor captured at
          // submit) before suppressing the UI: PRESERVE success —
          // their switch-back repeat must replay the original outcome,
          // not mint fresh and debit twice. Terminal observations also
          // record completion (processing notes must NOT): the stale
          // guard keys off completion time.
          noteOwnPendingVtuReference(descriptor, result.reference, ownKey);
          if (result.status !== 'processing') {
            markOwnPendingVtuCompleted(descriptor, ownKey);
          }
          // The charge committed but the suppressed onSuccess will never
          // fire the parent's wallet invalidation: refresh here so the
          // balance is not stale when the submitter returns. Never-fails
          // wrapper: a refetch rejection must not flip this recorded
          // success into `Payment Failed`.
          await refreshWalletAfterSuppressedVtuResult(payment);
          return;
        }
        if (getIsActive && !getIsActive()) {
          // Back-navigated mid-flight: PRESERVE the entry (reference +
          // completion) so a reopen retries with the SAME key and replays
          // this outcome instead of minting fresh and debiting twice.
          // Suppress onSuccess/Alert: the screen is gone.
          noteOwnPendingVtuReference(descriptor, result.reference, ownKey);
          if (result.status !== 'processing') {
            markOwnPendingVtuCompleted(descriptor, ownKey);
          }
          // The charge committed but the suppressed onSuccess will never
          // fire the parent's wallet invalidation: refresh here so the
          // wallet screen shows the post-debit balance. Never-fails
          // wrapper (see above): the recorded success stands even if the
          // refetch rejects.
          await refreshWalletAfterSuppressedVtuResult(payment);
          return;
        }
        // Never rotate while processing: the vend is still in flight
        // server-side; rotating would bypass the claim and double-debit.
        if (result.status === 'processing') {
          noteOwnPendingVtuReference(descriptor, result.reference, ownKey);
        }
        if (
          result.status === 'successful' &&
          isOwnPendingVtuStaleSuccess(descriptor, result.reference, ownKey)
        ) {
          // Old replay answering a NEW intent: forget so the next tap
          // mints fresh, and say so instead of presenting it as new.
          await forgetOwnPendingVtuPurchaseDurable(descriptor, ownKey);
          Alert.alert(
            'Purchase Already Completed',
            `This purchase already completed (${result.reference}). Submit again to make a new purchase.`
          );
          return;
        }
        if (result.status === 'successful') {
          // Durable (Codex R153 P2): lands before onSuccess finalizes.
          await forgetOwnPendingVtuPurchaseDurable(descriptor, ownKey);
        }
        const cashback = creditedVtuCashback(result.cashback);
        onSuccess({
          amount: result.amount ?? planAmount,
          customerIdentifier: phoneNumber,
          cashback: cashback
            ? {
                amount: cashback.amount,
                newBalance: cashback.newBalance,
              }
            : undefined,
          reference: result.reference,
          status: result.status,
          voucherPin: result.voucherPin,
        });
        return;
      } catch (error) {
        if (
          shouldDiscardVtuResultForAccountSwitch(
            payment,
            submittingOwner,
            getIsActive
          )
        ) {
          // Definitive rejections rotated inside charge; suppress only.
          return;
        }
        // Keep the key for ambiguous failures (network, timeout, 5xx,
        // pre-route 401/403/413/415/429, unknown) so the route's dedupe
        // table protects retries. Rotate only on definitive route 4xx.
        if (shouldRotateWalletIdempotencyKeyForError(error)) {
          // The rejection may prove a stale balance (e.g. 400 after
          // another spend): AWAIT the refetch (never rejects), else a
          // quick retry re-passes on it. On-screen only — off-screen
          // uses the never-fails refresh below, never the Alert.
          if (!getIsActive || getIsActive()) {
            await payment.refetchWallet();
          }
        }
        if (getIsActive && !getIsActive()) {
          // Screen gone: refresh (a 5xx may have committed while its
          // response was lost, and the retained key re-serves the
          // cached balance on reopen — without this the client gate
          // validates against the pre-debit balance) then suppress
          // the failure UI (no Alert over the new screen). Never-fails
          // wrapper: the refresh must not surface as Payment Failed.
          await refreshWalletAfterSuppressedVtuResult(payment);
          return;
        }
        throw error;
      }
    } catch (error) {
      Alert.alert(
        'Payment Failed',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      // Unconditional: this try is entered only after acquiring.
      releaseUtilityCheckout();
      if (!getIsActive || getIsActive()) {
        setIsSubmitting(false);
      }
    }
  };
}
