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
  klumpLimits?: {
    minAmount?: number | null;
    maxAmount?: number | null;
  };
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
    klumpLimits,
    methodDisabledReasons,
    orderTotal,
    selectedMethod,
    selectedTab,
    walletSelection,
    savingsSelection,
  } = input;

  const hasValidTotal =
    orderTotal != null && Number.isFinite(orderTotal) && orderTotal > 0;
  const rawSavingsAmount =
    savingsSelection?.use === true
      ? Math.max(0, savingsSelection.amount ?? 0)
      : 0;
  const activeSavingsAmount = hasValidTotal
    ? Math.min(rawSavingsAmount, orderTotal)
    : 0;
  const walletResidualAfterSavings = hasValidTotal
    ? Math.max(orderTotal - activeSavingsAmount, 0)
    : 0;
  const rawWalletAmount =
    walletSelection?.use === true
      ? Math.max(0, walletSelection.amount ?? 0)
      : 0;
  const activeWalletAmount = hasValidTotal
    ? Math.min(rawWalletAmount, walletResidualAfterSavings)
    : 0;
  const netPayableAmount = hasValidTotal
    ? Math.max(orderTotal - activeSavingsAmount - activeWalletAmount, 0)
    : 0;
  const klumpMinAmount = klumpLimits?.minAmount ?? BNPL_MIN_AMOUNT;
  const klumpMaxAmount = klumpLimits?.maxAmount ?? BNPL_MAX_AMOUNT;
  const getInstallmentRange = (methodId: PaymentMethodType) =>
    methodId === 'klump'
      ? { min: klumpMinAmount, max: klumpMaxAmount }
      : { min: BNPL_MIN_AMOUNT, max: BNPL_MAX_AMOUNT };
  const isInstallmentMethodEligible = (methodId: PaymentMethodType) => {
    if (!hasValidTotal || netPayableAmount <= 0) {
      return false;
    }
    const { min, max } = getInstallmentRange(methodId);
    return netPayableAmount >= min && netPayableAmount <= max;
  };

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

  const isBNPLEligible = candidateMethods.some(
    (method) =>
      method.tab === 'installments' && isInstallmentMethodEligible(method.id)
  );
  const hasBNPLMethods = candidateMethods.some(
    (method) => method.tab === 'installments'
  );
  const hasPayLaterMethods = candidateMethods.some(
    (method) => method.tab === 'pay_later'
  );

  const filteredMethods = candidateMethods
    .filter((method) => method.tab === selectedTab)
    .map((method) => {
      const disabledReason = methodDisabledReasons[method.id];
      if (disabledReason) {
        return {
          ...method,
          disabled: true,
          disabledReason,
        };
      }

      if (
        method.tab === 'installments' &&
        !isInstallmentMethodEligible(method.id)
      ) {
        const { min, max } = getInstallmentRange(method.id);
        const reason =
          hasValidTotal && netPayableAmount <= 0
            ? 'No payable balance remains for installment financing'
            : hasValidTotal && netPayableAmount > max
              ? `Maximum order: ${formatPrice(max)}`
              : `Minimum order: ${formatPrice(min)}`;
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
