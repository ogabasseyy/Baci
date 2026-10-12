import { useRef, useState } from 'react';
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
import type { Customer } from '@/stores/auth-store.types';
import type { AirtimeFormProps } from './airtime-form.types';
import {
  getAirtimeCustomerName,
  validateAirtimePurchaseInput,
} from './airtime-form-controller.helpers';
import { useMountedRef } from './use-mounted-ref';
import { shouldDiscardVtuResultForAccountSwitch } from './vtu-account-switch';

interface UseAirtimePurchaseHandlerProps {
  amount: string;
  numericAmount: number;
  phoneNumber: string;
  selectedProvider: string | null;
  payment: ReturnType<typeof useUtilityPayment>;
  customer: Customer | null;
  onSuccess: AirtimeFormProps['onSuccess'];
  dismissKeyboard: () => void;
  returnToHref?: WalletReturnHref | null;
  /**
   * Screen liveness probe. Defaults to this hook's own mount state
   * (mount = form mounted); injectable for tests.
   */
  getIsActive?: () => boolean;
}

interface ExecuteAirtimePurchaseInput {
  customer: Customer | null;
  getIsActive?: () => boolean;
  numericAmount: number;
  onSettled: () => void;
  onSuccess: AirtimeFormProps['onSuccess'];
  payment: ReturnType<typeof useUtilityPayment>;
  phoneNumber: string;
  selectedProvider: string | null;
}

/**
 * Wallet-only airtime purchase. The wallet must cover the full amount —
 * there is no card or gateway fallback.
 */
async function executeAirtimePurchase({
  customer,
  getIsActive,
  numericAmount,
  onSettled,
  onSuccess,
  payment,
  phoneNumber,
  selectedProvider,
}: ExecuteAirtimePurchaseInput): Promise<void> {
  try {
    const customerName = getAirtimeCustomerName(customer);
    const request = {
      amount: numericAmount,
      customerName,
      customerPhone: customer?.phone,
      networkProvider: selectedProvider ?? undefined,
      phoneNumber,
      type: 'airtime' as const,
      walletAmount: numericAmount,
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
      if (
        shouldDiscardVtuResultForAccountSwitch(
          payment,
          submittingOwner,
          getIsActive
        )
      ) {
        // Finalize the SUBMITTER's entry (descriptor captured at submit)
        // before suppressing the UI: PRESERVE success (terminal and
        // processing) — the charge committed while their UI was
        // suppressed, so their switch-back repeat must replay the
        // original outcome, not mint fresh and debit twice. Terminal
        // observations also record completion (processing notes must
        // NOT): the stale guard keys off completion time.
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
      if (result.status === 'processing') {
        notePendingVtuReference(descriptor, result.reference);
        onSuccess({
          amount: result.amount ?? numericAmount,
          customerIdentifier: phoneNumber,
          reference: result.reference,
          status: 'processing',
        });
        return;
      }
      if (isStalePendingVtuSuccess(descriptor, result.reference)) {
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
      payment.resetWalletIdempotencyKey(descriptor);
      onSuccess({
        amount: result.amount ?? numericAmount,
        cashback: creditedVtuCashback(result.cashback),
        customerIdentifier: phoneNumber,
        reference: result.reference,
        status: 'successful',
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
        // Still finalize status-bearing terminal errors for the
        // SUBMITTER (descriptor captured at submit): otherwise the
        // retained key replays the dead transaction when they retry.
        if (shouldRotateWalletIdempotencyKeyForError(error)) {
          payment.resetWalletIdempotencyKey(descriptor);
        }
        return;
      }
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
      if (getIsActive && !getIsActive()) {
        // Screen gone: rotation + refetch above already finalized the
        // entry — suppress the failure UI (no Alert over the new
        // screen).
        return;
      }
      throw error;
    }
  } catch (error) {
    console.error('Airtime purchase failed:', error);
    Alert.alert(
      'Payment Failed',
      error instanceof Error ? error.message : 'Something went wrong.'
    );
  } finally {
    if (!getIsActive || getIsActive()) {
      onSettled();
    }
  }
}

export function useAirtimePurchaseHandler({
  amount,
  numericAmount,
  phoneNumber,
  selectedProvider,
  payment,
  customer,
  onSuccess,
  dismissKeyboard,
  returnToHref,
  getIsActive: getIsActiveProp,
}: UseAirtimePurchaseHandlerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const mountedRef = useMountedRef();
  const getIsActive = getIsActiveProp ?? (() => mountedRef.current);

  const handlePurchase = async () => {
    dismissKeyboard();
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;

    const validationError = validateAirtimePurchaseInput({
      amount,
      numericAmount,
      phoneNumber,
      selectedProvider,
    });
    if (validationError) {
      Alert.alert(validationError.title, validationError.message);
      isSubmittingRef.current = false;
      return;
    }

    if (
      !ensureUtilityWalletReady({
        amount: numericAmount,
        payment,
        returnToHref,
      })
    ) {
      isSubmittingRef.current = false;
      return;
    }

    setIsSubmitting(true);
    await executeAirtimePurchase({
      customer,
      getIsActive,
      numericAmount,
      onSettled: () => {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      },
      onSuccess,
      payment,
      phoneNumber,
      selectedProvider,
    });
  };

  return {
    isSubmitting,
    isSubmittingRef,
    handlePurchase,
  };
}
