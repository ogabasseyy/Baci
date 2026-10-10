import { Alert } from 'react-native';
import { HttpError } from '@/lib/fetch-with-timeout';
import { promptUtilityWalletFunding } from '@/lib/utility-wallet-funding-prompt';
import {
  chargeWalletForVtu,
  shouldRotateWalletIdempotencyKeyForError,
} from '@/lib/vtu-checkout';
import { IDENTIFIER_LABELS } from './bill-form.constants';
import type { CreateBillFormPurchaseHandlerInput } from './bill-form-purchase.types';
import { getBillPaymentAmountError } from './bill-payment-amount-validation';
import { resolveBillCustomerOfRecord } from './resolve-bill-customer-of-record';
import { resolveBillFulfillment } from './resolve-bill-fulfillment';

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

    setIsSubmitting(true);
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
      // Wallet-only checkout: the wallet must cover the full bill — there
      // is no card or gateway fallback.
      if (payment.walletBalance < numericAmount) {
        promptUtilityWalletFunding({
          amount: numericAmount,
          balance: payment.walletBalance,
          returnToHref,
        });
        return;
      }

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

      const idempotencyKey = payment.getWalletIdempotencyKey();
      try {
        const result = await chargeWalletForVtu({
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
          ...(requireValidationRef !== undefined
            ? { requireValidationRef }
            : {}),
          type: billType,
          ...(validationReference ? { validationReference } : {}),
          walletAmount: numericAmount,
          idempotencyKey,
        });
        // 'processing' is non-terminal — the vend is still in flight
        // server-side. Keep the key so a retry hits the route's
        // dedupe row instead of creating a second VTU transaction.
        if (result.status === 'processing') {
          emitSuccess({
            amount: result.amount ?? numericAmount,
            customerIdentifier: customerId,
            reference: result.reference,
            status: 'processing',
          });
          return;
        }
        // Terminal success — rotate the key so the next user-initiated
        // submit gets a fresh dedupe slot.
        payment.resetWalletIdempotencyKey();
        emitSuccess({
          amount: result.amount ?? numericAmount,
          cashback: result.cashback,
          customerIdentifier: customerId,
          reference: result.reference,
          status: 'successful',
          voucherPin: result.voucherPin,
        });
        return;
      } catch (error) {
        // Keep the idempotency key for any error that leaves room for
        // server state to have been persisted (network, timeout, 5xx,
        // unknown) so the user's retry hits the route's dedupe table.
        // Only rotate on 4xx — request was rejected before any state
        // was created and the same key would just keep failing.
        if (shouldRotateWalletIdempotencyKeyForError(error)) {
          payment.resetWalletIdempotencyKey();
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
