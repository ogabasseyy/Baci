import { Alert } from 'react-native';
import { getPendingVtuSettlementPass } from '@/hooks/use-vtu-retained-settlement';
import { HttpError } from '@/lib/fetch-with-timeout';
import { buildVtuPurchaseDescriptor } from '@/lib/pending-vtu-descriptor';
import {
  isStalePendingVtuSuccess,
  notePendingVtuReference,
} from '@/lib/pending-vtu-idempotency';
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
      // Enter submitting BEFORE the settle await: the ref flips
      // synchronously, so a second tap during the wait still hits the
      // guard. Validation rejections above never reach this (no
      // flash); a readiness rejection returns through finally, which
      // resets. Await BEFORE the peek (R66 6rvh_M): peeking first
      // would bypass the balance gate on an entry the pass then
      // proves terminal and forgets, minting fresh underfunded.
      setIsSubmitting(true);
      const settlementPass = getPendingVtuSettlementPass();
      if (settlementPass) {
        await settlementPass;
        // R73: popped during the gate — never submit into an abandoned
        // view. No-pass submits stay synchronous from the tap.
        if (getIsActive && !getIsActive()) {
          setIsSubmitting(false);
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
        return;
      }

      // Attach the verified meter address to every success result (API omits it).
      const emitSuccess: typeof onSuccess = (r) =>
        onSuccess(customerAddress ? { ...r, address: customerAddress } : r);
      // Descriptor-keyed recall: a remount (Back to Home, reopen) after
      // a 202 processing or a timeout retries with the SAME key, so the
      // route dedupes instead of debiting a second transaction.
      const descriptor = payment.scopePendingVtuDescriptor(
        buildVtuPurchaseDescriptor(request)
      );
      // The pass was already awaited above the peek; the capture below
      // recalls the same post-settle state.
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
        // Terminal success — rotate the key so the next user-initiated
        // submit gets a fresh dedupe slot.
        payment.resetWalletIdempotencyKey(descriptor);
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
      Alert.alert('Payment Failed', getSafePaymentErrorMessage(error));
    } finally {
      if (!getIsActive || getIsActive()) {
        setIsSubmitting(false);
      }
    }
  };
}
