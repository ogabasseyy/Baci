import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import {
  buildVtuPurchaseDescriptor,
  isStalePendingVtuSuccess,
  notePendingVtuReference,
} from '@/lib/pending-vtu-idempotency';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { ensureUtilityWalletReady } from '@/lib/utility-wallet-readiness';
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
    const descriptor = buildVtuPurchaseDescriptor(request);
    const idempotencyKey = payment.getWalletIdempotencyKey(descriptor);
    try {
      const result = await chargeWalletForVtu({
        ...request,
        idempotencyKey,
      });
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
        cashback: result.cashback,
        reference: result.reference,
        status: 'successful',
        voucherPin: result.voucherPin,
      });
      return;
    } catch (error) {
      if (shouldRotateWalletIdempotencyKeyForError(error)) {
        payment.resetWalletIdempotencyKey(descriptor);
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
