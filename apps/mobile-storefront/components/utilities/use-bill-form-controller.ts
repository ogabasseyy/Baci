import { useRef, useState } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACING } from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useUtilityPayment } from '@/hooks/use-utility-payment';
import { useVTUBillers } from '@/hooks/use-vtu-billers';
import { useVTUVerify } from '@/hooks/use-vtu-verify';
import type { UtilityBeneficiary } from '@/lib/utility-beneficiaries';
import { useAuthStore } from '@/stores/auth-store';
import {
  BILL_FORM_FOOTER_ERROR_BUFFER,
  BILL_FORM_FOOTER_HEIGHT,
  BILL_TYPE_MAP,
} from './bill-form.constants';
import { parseUtilityAmount } from './bill-form.helpers';
import type { BillFormProps } from './bill-form.types';
import type { BillFormController } from './bill-form-controller.types';
import { buildBillFormWalletReturnTo } from './build-bill-form-wallet-return-to';
import { createBillFormPurchaseHandler } from './create-bill-form-purchase-handler';
import { createBillFormVerifyHandler } from './create-bill-form-verify-handler';
import { createBillFormVerifySuccessHandler } from './create-bill-form-verify-success-handler';
import { getUtilityFooterOffset } from './get-utility-footer-offset';
import {
  type BillFormBeneficiarySaveRequest,
  useBillFormBeneficiaries,
} from './use-bill-form-beneficiaries';
import { useBillFormSelection } from './use-bill-form-selection';
import { useNextStepScroll } from './use-next-step-scroll';
import { formatUtilityAmountInput } from './utility-amount-format';

export type { BillFormController };

export function useBillFormController({
  initialAmount,
  initialBillerName,
  initialBillItemIdentifier,
  initialCustomerIdentifier,
  initialCustomerName,
  initialCustomerAddress,
  isRepeatPaymentReady = false,
  recentRecipients,
  type,
  onSuccess,
}: BillFormProps): BillFormController {
  const insets = useSafeAreaInsets();
  const { dismissKeyboard, isKeyboardVisible, keyboardHeight } = useKeyboard();
  const billType = BILL_TYPE_MAP[type];
  const billersQuery = useVTUBillers(billType);
  const verify = useVTUVerify();
  const customer = useAuthStore((state) => state.customer);
  const [customerId, setCustomerId] = useState(initialCustomerIdentifier ?? '');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [isRepeatPaymentActive, setIsRepeatPaymentActive] = useState(false);
  const [verifiedCustomerName, setVerifiedCustomerName] = useState<
    string | null
  >(initialCustomerName ?? null);
  const [verifiedCustomerAddress, setVerifiedCustomerAddress] = useState<
    string | null
  >(initialCustomerAddress ?? null);
  const [verifiedValidationReference, setVerifiedValidationReference] =
    useState<string | null>(null);
  const [verifiedRequireValidationRef, setVerifiedRequireValidationRef] =
    useState<boolean | undefined>(undefined);
  const [shouldScrollToNextStep, setShouldScrollToNextStep] = useState(false);
  const [shouldScrollToPayment, setShouldScrollToPayment] = useState(false);
  const pendingVerificationKeyRef = useRef<string | null>(null);
  const [verifiedSelectionKey, setVerifiedSelectionKey] = useState<
    string | null
  >(null);
  const [beneficiarySaveRequest, setBeneficiarySaveRequest] =
    useState<BillFormBeneficiarySaveRequest | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const scheduleNextStepScroll = useNextStepScroll(scrollViewRef, () => {
    setShouldScrollToNextStep(false);
  });
  const resetVerification = () => {
    pendingVerificationKeyRef.current = null;
    setVerifiedSelectionKey(null);
    setVerifiedCustomerAddress(null);
    setVerifiedValidationReference(null);
    setVerifiedRequireValidationRef(undefined);
    if (!verify.isPending) {
      verify.reset();
    }
  };
  const deactivateRepeatPayment = () => {
    setIsRepeatPaymentActive(false);
    setVerifiedCustomerName(null);
    setVerifiedCustomerAddress(null);
  };
  const {
    billItemSelection,
    handleBillItemSelect,
    handleBillerSelect,
    isBillItemSelectionComplete,
    isProviderPickerExpanded,
    requiresBillItemSelection,
    selectedBiller,
    selectedBillItem,
    selectedBillItemIdentifier,
    selectedBillItemPathLabel,
    setProviderPickerExpanded,
  } = useBillFormSelection({
    billers: billersQuery.data,
    // Returning users repeat more than they add: when beneficiaries exist the
    // provider grid starts collapsed behind "Other providers" (see BillForm).
    hasBeneficiaries: (recentRecipients?.length ?? 0) > 0,
    initialAmount,
    initialBillerName,
    initialBillItemIdentifier,
    initialCustomerIdentifier,
    isRepeatPaymentReady,
    onInitialRepeatPaymentReady: () => {
      setIsRepeatPaymentActive(true);
      setShouldScrollToPayment(true);
    },
    onSelectionChanged: () => {
      setShouldScrollToNextStep(true);
      deactivateRepeatPayment();
      resetVerification();
    },
    setAmount,
  });
  const numericAmount = parseUtilityAmount(amount);
  const payment = useUtilityPayment();
  const normalizedCustomerId = customerId.trim();
  const currentVerificationKey = `${selectedBiller?.billerId ?? ''}:${
    selectedBillItemIdentifier ?? ''
  }:${normalizedCustomerId}`;
  const canShowPayment = Boolean(
    isRepeatPaymentActive || verifiedSelectionKey === currentVerificationKey
  );

  const authenticatedCustomerId = customer?.id ?? null;
  const beneficiaries = useBillFormBeneficiaries({
    authenticatedCustomerId,
    saveRequest: beneficiarySaveRequest,
    selectedBiller,
    selectedBillItemIdentifier,
  });

  const handleVerifySuccess = createBillFormVerifySuccessHandler({
    authenticatedCustomerId,
    normalizedCustomerId,
    pendingVerificationKeyRef,
    selectedBiller,
    selectedBillItemIdentifier,
    setBeneficiarySaveRequest,
    setVerifiedCustomerAddress,
    setVerifiedCustomerName,
    setVerifiedRequireValidationRef,
    setVerifiedSelectionKey,
    setVerifiedValidationReference,
  });

  const handleVerify = createBillFormVerifyHandler({
    dismissKeyboard,
    isBillItemSelectionComplete,
    normalizedCustomerId,
    onVerifySuccess: handleVerifySuccess,
    pendingVerificationKeyRef,
    requiresBillItemSelection,
    selectedBiller,
    selectedBillItem,
    selectedBillItemIdentifier,
    type,
    verificationKey: currentVerificationKey,
    verify,
  });

  // Prefilled deep-link so a wallet top-up round-trips the customer back to a
  // ready-to-pay bill form (they still re-tap Pay — never auto-submitted).
  // `isVerified` is the form's real verified state (`canShowPayment`), NOT
  // "we have a customer name": billers may verify with no name at all.
  const walletReturnToHref = buildBillFormWalletReturnTo({
    billItemIdentifier: selectedBillItemIdentifier,
    customerAddress: verifiedCustomerAddress,
    customerIdentifier: normalizedCustomerId,
    customerName: verifiedCustomerName,
    isVerified: canShowPayment,
    numericAmount,
    selectedBiller,
    type,
  });

  const handleSelectBeneficiary = (beneficiary: UtilityBeneficiary) => {
    setCustomerId(beneficiary.customerId);
    deactivateRepeatPayment();
    resetVerification();
  };

  const updateSubmitting = (nextIsSubmitting: boolean) => {
    isSubmittingRef.current = nextIsSubmitting;
    setIsSubmitting(nextIsSubmitting);
  };

  const handlePurchase = () =>
    createBillFormPurchaseHandler({
      amount,
      billType,
      canShowPayment,
      customer,
      customerId,
      dismissKeyboard,
      getIsSubmitting: () => isSubmittingRef.current,
      numericAmount,
      onSuccess,
      payment,
      selectedBiller,
      selectedBillItem,
      selectedBillItemIdentifier,
      selectedBillItemPathLabel,
      requireValidationRef: verifiedRequireValidationRef,
      setIsSubmitting: updateSubmitting,
      type,
      validationReference: verifiedValidationReference ?? undefined,
      verifiedCustomerName,
      verifiedCustomerAddress,
      returnToHref: walletReturnToHref,
    })();

  const handlePaymentLayout = (event: LayoutChangeEvent) => {
    if (!shouldScrollToPayment) {
      return;
    }
    const paymentY = event.nativeEvent.layout.y;
    setShouldScrollToPayment(false);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({
        animated: true,
        y: Math.max(paymentY - SPACING.md, 0),
      });
    });
  };

  return {
    amount,
    beneficiaries,
    billersQuery,
    billItemSelection,
    canShowPayment,
    customerId,
    footerBottomOffset: getUtilityFooterOffset({
      bottomInset: insets.bottom,
      isKeyboardVisible,
      keyboardHeight,
    }),
    footerSpacerHeight: canShowPayment
      ? BILL_FORM_FOOTER_HEIGHT +
        Math.max(insets.bottom, SPACING.md) +
        BILL_FORM_FOOTER_ERROR_BUFFER
      : SPACING.xl,
    formattedAmount: formatUtilityAmountInput(amount),
    handleBillItemSelect,
    handleBillerSelect,
    handlePaymentLayout,
    handlePurchase,
    handleSelectBeneficiary,
    handleVerify,
    isBillItemSelectionComplete,
    isBusy: isSubmitting,
    isFixedAmount: selectedBillItem?.isAmountFixed ?? false,
    isKeyboardVisible,
    isProviderPickerExpanded,
    isRepeatPaymentActive,
    numericAmount,
    verifiedCustomerName,
    payment,
    resetVerification,
    scheduleNextStepScroll,
    scrollViewRef,
    selectedBiller,
    selectedBillItemIdentifier,
    setProviderPickerExpanded,
    setRepeatPaymentActive: (isActive: boolean) => {
      if (!isActive) {
        deactivateRepeatPayment();
        return;
      }
      setIsRepeatPaymentActive(true);
    },
    shouldScrollToNextStep,
    updateAmount: setAmount,
    updateCustomerId: (value: string) => {
      setCustomerId(value);
      // Editing the customer/meter ID invalidates any in-flight repeat-payment
      // session — clear it so canShowPayment can't stay true with stale
      // verified state attached to the previous identifier.
      deactivateRepeatPayment();
      resetVerification();
    },
    verify,
    walletReturnToHref,
    insets,
  };
}
