import { Alert } from 'react-native';
import { HttpError } from '@/lib/fetch-with-timeout';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import {
  forgetPendingVtuPurchaseDurable,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
} from '@/lib/pending-vtu-idempotency';
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
import { IDENTIFIER_LABELS } from './bill-form.constants';
import type { CreateBillFormPurchaseHandlerInput } from './bill-form-purchase.types';
import { getBillPaymentAmountError } from './bill-payment-amount-validation';
import { resolveBillCustomerOfRecord } from './resolve-bill-customer-of-record';
import { resolveBillFulfillment } from './resolve-bill-fulfillment';
import {
  awaitUtilitySettlementGate,
  preserveSuppressedVtuSuccess,
  refreshWalletAfterSuppressedVtuResult,
  shouldDiscardVtuResultForAccountSwitch,
} from './vtu-account-switch';

const GENERIC_PAYMENT_ERROR_MESSAGE = 'Payment failed. Please try again.';

function getSafePaymentErrorMessage(error: unknown): string {
  if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
    const message = error.message.trim();
    return message || GENERIC_PAYMENT_ERROR_MESSAGE;
  }

  return GENERIC_PAYMENT_ERROR_MESSAGE;
}

export function createBillFormPurchaseHandler({
  amount,
  billType,
  canShowPayment,
  customer,
  customerId,
  dismissKeyboard,
  getIsActive,
  getIsSubmitting,
  numericAmount,
  onSuccess,
  payment,
  selectedBiller,
  selectedBillItem,
  selectedBillItemIdentifier,
  selectedBillItemPathLabel,
  requireValidationRef,
  setIsSubmitting,
  type,
  validationReference,
  verifiedCustomerName,
  verifiedCustomerAddress,
  returnToHref,
}: CreateBillFormPurchaseHandlerInput) {
  return async () => {
    dismissKeyboard();
    if (getIsSubmitting()) {
      return;
    }

    // Function scope: the finally below runs for validation returns
    // too, and must release the guard only when this submit holds it.
    let checkoutAcquired = false;
    try {
      if (!selectedBiller) {
        Alert.alert('Missing Provider', 'Please select a provider.');
        return;
      }
      if (!canShowPayment) {
        Alert.alert(
          'Verification Required',
          `Please verify your ${IDENTIFIER_LABELS[type].toLowerCase()} before making a purchase.`
        );
        return;
      }
      if (!amount) {
        Alert.alert('Missing Amount', 'Please enter an amount.');
        return;
      }
      const amountError = getBillPaymentAmountError(
        numericAmount,
        selectedBillItem
      );
      if (amountError) {
        Alert.alert('Invalid Amount', amountError);
        return;
      }
      const { customerName, customerAddress } = resolveBillCustomerOfRecord({
        customer,
        verifiedCustomerName,
        verifiedCustomerAddress,
      });
      // Kuda-display + Monnify-fulfillment routing (folded items vend via Monnify).
      const {
        provider: selectedProvider,
        billerCode: selectedBillerCode,
        productCode: selectedProductCode,
      } = resolveBillFulfillment(
        selectedBillItem,
        selectedBiller,
        selectedBillItemIdentifier ?? undefined
      );

      const request = {
        amount: numericAmount,
        billItemIdentifier: selectedBillItemIdentifier ?? undefined,
        billerCode: selectedBillerCode,
        billerName: selectedBillItemPathLabel
          ? `${selectedBiller.billerName} - ${selectedBillItemPathLabel}`
          : selectedBiller.billerName,
        customerIdentifier: customerId,
        customerName,
        ...(customerAddress ? { customerAddress } : {}),
        customerPhone: customer?.phone || undefined,
        productCode: selectedProductCode,
        provider: selectedProvider,
        ...(requireValidationRef !== undefined ? { requireValidationRef } : {}),
        type: billType,
        ...(validationReference ? { validationReference } : {}),
        walletAmount: numericAmount,
      };
      // Submitting flips synchronously, so taps during the wait hit the
      // guard; validation above never reaches this (no flash).
      // Settle-await BEFORE the peek (R66): peeking first bypasses the
      // balance gate on entries the pass then forgets.
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
          amount: numericAmount,
          isRetainedReplay,
          payment,
          returnToHref,
        })
      ) {
        return;
      }

      // Screen-wide guard (Codex R77 6sNGO3): per-tab refs don't see
      // sibling tabs — refuse concurrent checkouts, don't queue.
      // Flagged: this try's validation returns run the finally,
      // which must release only when held.
      checkoutAcquired = acquireUtilityCheckoutOrAlert();
      if (!checkoutAcquired) {
        return;
      }

      // Attach the verified meter address to every success result (API omits it).
      const emitSuccess: typeof onSuccess = (r) =>
        onSuccess(customerAddress ? { ...r, address: customerAddress } : r);
      // Descriptor-keyed recall: remount retries reuse the SAME key so
      // the route dedupes instead of debiting a second transaction.
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
          // Back-navigated mid-flight: preserve for SAME-key replay on
          // reopen; suppress onSuccess/Alert (screen gone).
          await preserveSuppressedVtuSuccess(payment, descriptor, result);
          return;
        }
        // 'processing' is non-terminal — the vend is still in flight
        // server-side. Keep the key so a retry hits the route's
        // dedupe row instead of creating a second VTU transaction.
        if (result.status === 'processing') {
          notePendingVtuReference(descriptor, result.reference);
          emitSuccess({
            amount: result.amount ?? numericAmount,
            customerIdentifier: customerId,
            reference: result.reference,
            status: 'processing',
          });
          return;
        }
        if (isStalePendingVtuSuccess(descriptor, result.reference)) {
          // Old replay answering a NEW intent: forget so the next tap
          // mints fresh, and say so instead of presenting it as new.
          await forgetPendingVtuPurchaseDurable(descriptor);
          Alert.alert(
            'Purchase Already Completed',
            `This purchase already completed (${result.reference}). Submit again to make a new purchase.`
          );
          return;
        }
        // Terminal success — rotate the key so the next user-initiated
        // submit gets a fresh dedupe slot (durable: lands pre-finalize).
        await forgetPendingVtuPurchaseDurable(descriptor);
        emitSuccess({
          amount: result.amount ?? numericAmount,
          cashback: creditedVtuCashback(result.cashback),
          customerIdentifier: customerId,
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
        // Keep the idempotency key for any error that leaves room for
        // server state to have been persisted (network, timeout, 5xx,
        // pre-route 401/403/413/415/429, unknown) so the user's retry
        // hits the route's dedupe table. Only rotate on definitive
        // route 4xx — the same key would just keep failing.
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
      Alert.alert('Payment Failed', getSafePaymentErrorMessage(error));
    } finally {
      if (checkoutAcquired) {
        releaseUtilityCheckout();
      }
      if (!getIsActive || getIsActive()) {
        setIsSubmitting(false);
      }
    }
  };
}
