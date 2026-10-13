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
    // Descriptor-keyed recall: a remount (Back to Home, reopen) after
    // a 202 processing or a timeout retries with the SAME key, so the
    // route dedupes instead of debiting a second transaction.
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
        // Finalize the SUBMITTER's entry (descriptor captured at
        // submit) so their switch-back repeat replays the original
        // outcome instead of minting fresh and debiting twice.
        await preserveSuppressedVtuSuccess(payment, descriptor, result);
        return;
      }
      if (getIsActive && !getIsActive()) {
        // Back-navigated mid-flight: preserve so a reopen retries
        // with the SAME key and replays. Suppress onSuccess/Alert:
        // the screen is gone.
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
        // error below always survives. On-screen only: off-screen
        // falls through to the never-fails refresh below (one
        // refetch, and a rejection must not defeat the suppression
        // by landing in the outer catch's Alert).
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
    // Settle-then-submit gate (R60), awaited BEFORE the retained
    // peek (R66 6rvh_M): peeking first would bypass the balance gate
    // on an entry the pass then proves terminal and forgets, minting
    // fresh underfunded. The ref guard above was set synchronously at
    // entry, so this await admits no second submit.
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

    setIsSubmitting(true);
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
  };

  return {
    isSubmitting,
    isSubmittingRef,
    handlePurchase,
  };
}
