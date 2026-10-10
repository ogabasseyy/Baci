import { Alert } from 'react-native';
import type { useUtilityPayment } from '@/hooks/use-utility-payment';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { ensureUtilityWalletReady } from '@/lib/utility-wallet-readiness';
import {
  chargeWalletForVtu,
  shouldRotateWalletIdempotencyKeyForError,
} from '@/lib/vtu-checkout';

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
        customer,
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

      const idempotencyKey = payment.getWalletIdempotencyKey();
      try {
        const result = await chargeWalletForVtu({
          amount: planAmount,
          customerName,
          customerPhone: customer?.phone || undefined,
          dataPlanCode: selectedPlan,
          networkProvider: selectedProvider,
          phoneNumber,
          type: 'data',
          walletAmount: planAmount,
          idempotencyKey,
        });
        // Only rotate on terminal success. 'processing' means the
        // vend is still in flight server-side; rotating now would let
        // a user-initiated retry bypass the route's dedupe row and
        // create a duplicate VTU transaction.
        if (result.status === 'successful') {
          payment.resetWalletIdempotencyKey();
        }
        onSuccess({
          amount: result.amount ?? planAmount,
          cashback: result.cashback
            ? {
                amount: result.cashback.amount,
                newBalance: result.cashback.newBalance,
              }
            : undefined,
          reference: result.reference,
          status: result.status,
          voucherPin: result.voucherPin,
        });
        return;
      } catch (error) {
        // Keep the key for ambiguous failures (network, timeout, 5xx,
        // unknown) so the route's dedupe table protects retries.
        // Rotate only on 4xx — request rejected before any state.
        if (shouldRotateWalletIdempotencyKeyForError(error)) {
          payment.resetWalletIdempotencyKey();
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
