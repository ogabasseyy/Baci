import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import { getPendingVtuSettlementPass } from '@/hooks/use-vtu-retained-settlement';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import {
  isStalePendingVtuSuccess,
  notePendingVtuReference,
} from '@/lib/pending-vtu-idempotency';
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
import type { Customer } from '@/stores/auth-store.types';
import type { AirtimeFormProps } from './airtime-form.types';
import {
  getAirtimeCustomerName,
  validateAirtimePurchaseInput,
} from './airtime-form-controller.helpers';
import { useMountedRef } from './use-mounted-ref';
import {
  preserveSuppressedVtuSuccess,
  refreshWalletAfterSuppressedVtuResult,
  shouldDiscardVtuResultForAccountSwitch,
} from './vtu-account-switch';

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
  /** Screen liveness probe (mount state by default; injectable). */
  getIsActive?: () => boolean;
}

interface ExecuteAirtimePurchaseInput {
  getIsActive?: () => boolean;
  numericAmount: number;
  onSettled: () => void;
  onSuccess: AirtimeFormProps['onSuccess'];
  payment: ReturnType<typeof useUtilityPayment>;
  phoneNumber: string;
  /** Caller-prebuilt (peek-signed): never rebuilt, no peek/submit drift. */
  request: {
    amount: number;
    customerName: string;
    customerPhone: string | undefined;
    networkProvider: string | undefined;
    phoneNumber: string;
    type: 'airtime';
    walletAmount: number;
  };
}

/**
 * Wallet-only airtime purchase. The wallet must cover the full amount —
 * there is no card or gateway fallback.
 */
async function executeAirtimePurchase({
  getIsActive,
  numericAmount,
  onSettled,
  onSuccess,
  payment,
  phoneNumber,
  request,
}: ExecuteAirtimePurchaseInput): Promise<void> {
  try {
    // Descriptor-keyed recall: remount retries reuse the SAME key so
    // the route dedupes instead of debiting a second transaction.
    const descriptor = payment.scopePendingVtuDescriptor(
      buildVtuPurchaseDescriptor(request)
    );
    // The pass was already awaited above the retained peek in
    // handlePurchase; the capture below recalls post-settle state.
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
        // Finalize the SUBMITTER's entry so switch-back repeats replay
        // the original outcome instead of minting fresh.
        await preserveSuppressedVtuSuccess(payment, descriptor, result);
        return;
      }
      if (getIsActive && !getIsActive()) {
        // Back-navigated mid-flight: preserve for SAME-key replay on
        // reopen; suppress onSuccess/Alert (screen gone).
        await preserveSuppressedVtuSuccess(payment, descriptor, result);
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
        // Old replay answering a NEW intent: forget so the next tap
        // mints fresh, and say so instead of presenting it as new.
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

    const request = {
      amount: numericAmount,
      customerName: getAirtimeCustomerName(customer),
      customerPhone: customer?.phone,
      networkProvider: selectedProvider ?? undefined,
      phoneNumber,
      type: 'airtime' as const,
      walletAmount: numericAmount,
    };
    // Settle-then-submit gate (R60) BEFORE the retained peek (R66):
    // peeking first bypasses the balance gate on entries the pass
    // then proves terminal. Sync ref guard admits no second submit.
    const settlementPass = getPendingVtuSettlementPass();
    if (settlementPass) {
      await settlementPass;
      // R73: popped during the gate — never submit into an abandoned
      // view. No-pass submits stay synchronous from the tap.
      if (!getIsActive()) {
        isSubmittingRef.current = false;
        return;
      }
    }
    // Retained-replay peek (R65 6ru4mK): the SAME request the submit
    // signs with — a charged-but-unanswered retry must bypass the
    // balance gate instead of stranding behind top-up.
    const isRetainedReplay = payment.hasRetainedVtuAttempt(request);
    if (
      !ensureUtilityWalletReady({
        amount: numericAmount,
        isRetainedReplay,
        payment,
        returnToHref,
      })
    ) {
      isSubmittingRef.current = false;
      return;
    }

    // Screen-wide guard (Codex R77 6sNGO3): per-tab refs don't see
    // sibling tabs — refuse concurrent checkouts, don't queue.
    if (!acquireUtilityCheckoutOrAlert()) {
      isSubmittingRef.current = false;
      return;
    }
    setIsSubmitting(true);
    try {
      await executeAirtimePurchase({
        getIsActive,
        numericAmount,
        onSettled: () => {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        },
        onSuccess,
        payment,
        phoneNumber,
        request,
      });
    } finally {
      releaseUtilityCheckout();
    }
  };

  return {
    isSubmitting,
    isSubmittingRef,
    handlePurchase,
  };
}
