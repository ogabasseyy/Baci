import { Alert } from 'react-native';
import { HttpError } from '@/lib/fetch-with-timeout';
import {
  buildVtuPurchaseDescriptor,
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
import { shouldDiscardVtuResultForAccountSwitch } from './vtu-account-switch';

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
      if (
        !ensureUtilityWalletReady({
          amount: numericAmount,
          payment,
          returnToHref,
        })
      ) {
        return;
      }

      // Only enter the submitting state after validation and the wallet
      // readiness gate pass — matches the airtime/data handlers and avoids
      // flashing submitting UI on every validation rejection. Everything
      // above is synchronous, so the getIsSubmitting reentrancy guard at
      // the top still holds.
      setIsSubmitting(true);

      const { customerName, customerAddress } = resolveBillCustomerOfRecord({
        customer,
        verifiedCustomerName,
        verifiedCustomerAddress,
      });
      // Attach the verified meter address to every success result (API omits it).
      const emitSuccess: typeof onSuccess = (r) =>
        onSuccess(customerAddress ? { ...r, address: customerAddress } : r);
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
          // submit) before suppressing the UI: terminal success forgets
          // (repeat mints fresh); processing notes the reference.
          if (result.status === 'processing') {
            notePendingVtuReference(descriptor, result.reference);
          } else {
            payment.resetWalletIdempotencyKey(descriptor);
          }
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
        if (shouldDiscardVtuResultForAccountSwitch(payment, submittingOwner)) {
          return;
        }
        // Keep the idempotency key for any error that leaves room for
        // server state to have been persisted (network, timeout, 5xx,
        // unknown) so the user's retry hits the route's dedupe table.
        // Only rotate on 4xx — request was rejected before any state
        // was created and the same key would just keep failing.
        if (shouldRotateWalletIdempotencyKeyForError(error)) {
          payment.resetWalletIdempotencyKey(descriptor);
        }
        throw error;
      }
    } catch (error) {
      Alert.alert('Payment Failed', getSafePaymentErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };
}
