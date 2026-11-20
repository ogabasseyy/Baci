import { getOxygenMobileProfile } from '@/lib/oxygen-mobile-profile';
import { isStoreCreditCompatiblePayment } from '@/lib/store-credit-compatible-payment';
import { formatPrice } from '@/stores/cart-store';
import { PAYMENT_METHODS } from './paymentMethods';
import {
  BNPL_MAX_AMOUNT,
  BNPL_MIN_AMOUNT,
  type PaymentMethod,
  type PaymentMethodType,
  type PaymentTab,
  type SavingsSelection,
  type WalletSelection,
} from './types';

interface UsePaymentMethodAvailabilityInput {
  enabledMethods?: PaymentMethodType[];
  hiddenMethods?: PaymentMethodType[];
  methodDisabledReasons: Partial<Record<PaymentMethodType, string>>;
  orderTotal: number;
  selectedMethod: PaymentMethodType | null;
  selectedTab: PaymentTab | null;
  walletSelection?: WalletSelection;
  savingsSelection?: SavingsSelection;
}

interface UsePaymentMethodAvailabilityResult {
  availableMethodIds: PaymentMethodType[];
  filteredMethods: PaymentMethod[];
  hasBNPLMethods: boolean;
  hasPayLaterMethods: boolean;
  hasValidTotal: boolean;
  isBNPLEligible: boolean;
  supportsPartialPayment: boolean;
}

export function usePaymentMethodAvailability(
  input: UsePaymentMethodAvailabilityInput
): UsePaymentMethodAvailabilityResult {
  const {
    enabledMethods,
    hiddenMethods = [],
    methodDisabledReasons,
    orderTotal,
    selectedMethod,
    selectedTab,
    walletSelection,
    savingsSelection,
  } = input;

  const hasValidTotal =
    orderTotal != null && Number.isFinite(orderTotal) && orderTotal > 0;
  const isBNPLEligible =
    hasValidTotal &&
    orderTotal >= BNPL_MIN_AMOUNT &&
    orderTotal <= BNPL_MAX_AMOUNT;

  const enabledCandidates = PAYMENT_METHODS.filter(
    (method) =>
      (method.id !== 'oxygen' ||
        (enabledMethods?.includes('oxygen') &&
          Boolean(getOxygenMobileProfile()))) &&
      (!enabledMethods || enabledMethods.includes(method.id))
  ).filter((method) => !hiddenMethods.includes(method.id));

  // Paystack and Korapay are both "Pay with Card" gateways — never render two
  // identical card rows. Prefer Paystack (bank transfer rides on its DVA); fall
  // back to the Korapay card row when Paystack is disabled.
  const candidateMethods = enabledCandidates.some(
    (method) => method.id === 'paystack'
  )
    ? enabledCandidates.filter((method) => method.id !== 'korapay')
    : enabledCandidates;

  const hasBNPLMethods = candidateMethods.some(
    (method) => method.tab === 'installments'
  );
  const hasPayLaterMethods = candidateMethods.some(
    (method) => method.tab === 'pay_later'
  );

  const filteredMethods = candidateMethods
    .filter((method) => method.tab === selectedTab)
    .map((method) => {
      const walletDisablesKlump =
        method.id === 'klump' &&
        walletSelection?.use === true &&
        (walletSelection.amount ?? 0) > 0;
      if (walletDisablesKlump) {
        return {
          ...method,
          disabled: true,
          disabledReason: 'Wallet credit cannot be combined with Klump',
        };
      }

      const savingsDisablesKlump =
        method.id === 'klump' &&
        savingsSelection?.use === true &&
        (savingsSelection.amount ?? 0) > 0;
      if (savingsDisablesKlump) {
        return {
          ...method,
          disabled: true,
          disabledReason: 'Device savings cannot be combined with Klump',
        };
      }

      const disabledReason = methodDisabledReasons[method.id];
      if (disabledReason) {
        return {
          ...method,
          disabled: true,
          disabledReason,
        };
      }

      if (method.tab === 'installments' && !isBNPLEligible) {
        const reason =
          hasValidTotal && orderTotal > BNPL_MAX_AMOUNT
            ? `Maximum order: ${formatPrice(BNPL_MAX_AMOUNT)}`
            : `Minimum order: ${formatPrice(BNPL_MIN_AMOUNT)}`;
        return {
          ...method,
          disabled: true,
          disabledReason: reason,
        };
      }

      return method;
    });

  const supportsPartialPayment = isStoreCreditCompatiblePayment({
    paymentTab: selectedTab,
    selectedPayment: selectedMethod,
  });

  return {
    availableMethodIds: candidateMethods.map((method) => method.id),
    filteredMethods,
    hasBNPLMethods,
    hasPayLaterMethods,
    hasValidTotal,
    isBNPLEligible,
    supportsPartialPayment,
  };
}
