import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { promptUtilityWalletFunding } from '@/lib/utility-wallet-funding-prompt';
import {
  chargeWalletForVtu,
  shouldRotateWalletIdempotencyKeyForError,
} from '@/lib/vtu-checkout';
import type { Customer } from '@/stores/auth-store.types';
import type { AirtimeFormProps } from './airtime-form.types';
import {
  getAirtimeCustomerName,
  validateAirtimePurchaseInput,
} from './airtime-form-controller.helpers';

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
}

interface ExecuteAirtimePurchaseInput {
  customer: Customer | null;
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
  numericAmount,
  onSettled,
  onSuccess,
  payment,
  phoneNumber,
  selectedProvider,
}: ExecuteAirtimePurchaseInput): Promise<void> {
  try {
    const customerName = getAirtimeCustomerName(customer);
    const idempotencyKey = payment.getWalletIdempotencyKey();
    try {
      const result = await chargeWalletForVtu({
        amount: numericAmount,
        customerName,
        customerPhone: customer?.phone,
        networkProvider: selectedProvider ?? undefined,
        phoneNumber,
        type: 'airtime',
        walletAmount: numericAmount,
        idempotencyKey,
      });
      if (result.status === 'processing') {
        onSuccess({
          amount: result.amount ?? numericAmount,
          customerIdentifier: phoneNumber,
          reference: result.reference,
          status: 'processing',
        });
        return;
      }
      payment.resetWalletIdempotencyKey();
      onSuccess({
        amount: result.amount ?? numericAmount,
        cashback: result.cashback,
        reference: result.reference,
        status: 'successful',
        voucherPin: result.voucherPin,
      });
      return;
    } catch (error) {
      if (shouldRotateWalletIdempotencyKeyForError(error)) {
        payment.resetWalletIdempotencyKey();
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
    onSettled();
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
}: UseAirtimePurchaseHandlerProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

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

    if (payment.walletBalance < numericAmount) {
      promptUtilityWalletFunding({
        amount: numericAmount,
        balance: payment.walletBalance,
        returnToHref,
      });
      isSubmittingRef.current = false;
      return;
    }

    setIsSubmitting(true);
    await executeAirtimePurchase({
      customer,
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
