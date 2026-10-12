import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import {
  buildVtuPurchaseDescriptor,
  isStalePendingVtuSuccess,
  markPendingVtuCompleted,
  notePendingVtuReference,
} from '@/lib/pending-vtu-idempotency';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { ensureUtilityWalletReady } from '@/lib/utility-wallet-readiness';
import {
  chargeWalletForVtu,
  creditedVtuCashback,
  shouldRotateWalletIdempotencyKeyForError,
} from '@/lib/vtu-checkout';
import { shouldDiscardVtuResultForAccountSwitch } from './vtu-account-switch';

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
    if (
      !ensureUtilityWalletReady({
        amount: planAmount,
        payment,
        returnToHref,
      })
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
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
      // Descriptor-keyed recall: a remount (Back to Home, reopen) after
      // a 202 processing or a timeout retries with the SAME key, so the
      // route dedupes instead of debiting a second transaction.
      const descriptor = payment.scopePendingVtuDescriptor(
        buildVtuPurchaseDescriptor(request)
      );
      const idempotencyKey = payment.getWalletIdempotencyKey(descriptor);
      const submittingOwner = payment.captureSubmittingOwner();
      const submittingUserId = payment.captureSubmittingUserId();
      try {
        const result = await chargeWalletForVtu({
          ...request,
          expectedUserId: submittingUserId,
          idempotencyKey,
        });
        if (shouldDiscardVtuResultForAccountSwitch(payment, submittingOwner)) {
          // Finalize the SUBMITTER's entry (descriptor captured at
          // submit) before suppressing the UI: PRESERVE success —
          // their switch-back repeat must replay the original outcome,
          // not mint fresh and debit twice. Terminal observations also
          // record completion (processing notes must NOT): the stale
          // guard keys off completion time.
          notePendingVtuReference(descriptor, result.reference);
          if (result.status !== 'processing') {
            markPendingVtuCompleted(descriptor);
          }
          return;
        }
        if (getIsActive && !getIsActive()) {
          // Back-navigated mid-flight: PRESERVE the entry (reference +
          // completion) so a reopen retries with the SAME key and replays
          // this outcome instead of minting fresh and debiting twice.
          // Suppress onSuccess/Alert: the screen is gone.
          notePendingVtuReference(descriptor, result.reference);
          if (result.status !== 'processing') {
            markPendingVtuCompleted(descriptor);
          }
          return;
        }
        // Only rotate on terminal success. 'processing' means the
        // vend is still in flight server-side; rotating now would let
        // a user-initiated retry bypass the route's dedupe row and
        // create a duplicate VTU transaction.
        if (result.status === 'processing') {
          notePendingVtuReference(descriptor, result.reference);
        }
        if (
          result.status === 'successful' &&
          isStalePendingVtuSuccess(descriptor, result.reference)
        ) {
          // The remembered purchase completed long ago: this replay
          // answers a NEW intent with the old vend. Forget so the next
          // tap mints a fresh key, and say so instead of presenting the
          // earlier purchase as the new one.
          payment.resetWalletIdempotencyKey(descriptor);
          Alert.alert(
            'Purchase Already Completed',
            `This purchase already completed (${result.reference}). Submit again to make a new purchase.`
          );
          return;
        }
        if (result.status === 'successful') {
          payment.resetWalletIdempotencyKey(descriptor);
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
        if (shouldDiscardVtuResultForAccountSwitch(payment, submittingOwner)) {
          // Still finalize status-bearing terminal errors for the
          // SUBMITTER (descriptor captured at submit): otherwise the
          // retained key replays the dead transaction when they retry.
          if (shouldRotateWalletIdempotencyKeyForError(error)) {
            payment.resetWalletIdempotencyKey(descriptor);
          }
          return;
        }
        // Keep the key for ambiguous failures (network, timeout, 5xx,
        // pre-route 401/403/413/415/429, unknown) so the route's dedupe
        // table protects retries. Rotate only on definitive route 4xx.
        if (shouldRotateWalletIdempotencyKeyForError(error)) {
          payment.resetWalletIdempotencyKey(descriptor);
          // The rejection may prove a stale balance (e.g. 400
          // insufficient funds after another spend): AWAIT the refetch
          // (fire-and-forget would let a quick retry re-pass on the
          // stale balance — `walletIsLoading` is false during
          // background refetches). Never rejects, so the original
          // error below always survives.
          await payment.refetchWallet();
        }
        throw error;
      }
    } catch (error) {
      Alert.alert(
        'Payment Failed',
        error instanceof Error ? error.message : 'Something went wrong.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };
}
