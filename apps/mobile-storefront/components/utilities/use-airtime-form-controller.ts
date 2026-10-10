import { useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SPACING } from '@/constants/Colors';
import { NETWORK_PROVIDERS } from '@/constants/network-providers';
import { useKeyboard } from '@/hooks/use-keyboard';
import { useUtilityPayment } from '@/hooks/use-utility-payment';
import { useAuthStore } from '@/stores/auth-store';
import type { AirtimeFormProps } from './airtime-form.types';
import {
  resolveAirtimeProvider,
  sanitizeAirtimeAmountInput,
  sanitizePhoneDigits,
  scrollToAirtimePaymentSection,
} from './airtime-form-controller.helpers';
import { buildUtilityWalletReturnTo } from './build-utility-wallet-return-to';
import { getUtilityFooterOffset } from './get-utility-footer-offset';
import { useAirtimePurchaseHandler } from './use-airtime-purchase-handler';
import { formatUtilityAmountInput } from './utility-amount-format';

const FOOTER_HEIGHT = 120;
const FOOTER_ERROR_BUFFER = 36;

export function useAirtimeFormController(props: AirtimeFormProps) {
  const {
    initialAmount,
    initialPhoneNumber,
    initialProvider,
    isRepeatPaymentReady = false,
    onSuccess,
  } = props;
  const insets = useSafeAreaInsets();
  const { dismissKeyboard, isKeyboardVisible, keyboardHeight } = useKeyboard();
  const customer = useAuthStore((state) => state.customer);
  const scrollViewRef = useRef<ScrollView>(null);
  const prevIsRepeatPaymentReadyRef = useRef(isRepeatPaymentReady);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(
    initialProvider ??
      (initialPhoneNumber ? resolveAirtimeProvider(initialPhoneNumber) : null)
  );
  const [isBeneficiarySelected, setIsBeneficiarySelected] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber ?? '');
  const [amount, setAmount] = useState(initialAmount ?? '');
  const [isNetworkPickerExpanded, setIsNetworkPickerExpanded] = useState(false);
  const [shouldScrollToPayment, setShouldScrollToPayment] =
    useState(isRepeatPaymentReady);
  const numericAmount = Number(amount.replace(/\D/g, ''));
  const payment = useUtilityPayment();
  const selectedProviderConfig =
    NETWORK_PROVIDERS.find((provider) => provider.id === selectedProvider) ??
    null;

  useEffect(() => {
    if (!prevIsRepeatPaymentReadyRef.current && isRepeatPaymentReady) {
      setShouldScrollToPayment(true);
    }
    prevIsRepeatPaymentReadyRef.current = isRepeatPaymentReady;
  }, [isRepeatPaymentReady]);

  const handlePhoneChange = (text: string) => {
    setIsBeneficiarySelected(false);
    const digits = sanitizePhoneDigits(text);
    setPhoneNumber(digits);
    setSelectedProvider(resolveAirtimeProvider(digits));
    setIsNetworkPickerExpanded(false);
  };

  const updateAmount = (value: string) => {
    setAmount(sanitizeAirtimeAmountInput(value));
  };

  // Prefilled deep-link so a wallet top-up round-trips the customer back to a
  // ready-to-buy airtime form (they still re-tap Buy — never auto-submitted).
  const walletReturnToHref = buildUtilityWalletReturnTo({
    amount: numericAmount,
    networkProvider: selectedProvider,
    phoneNumber,
    type: 'airtime',
  });

  const { isSubmitting, handlePurchase } = useAirtimePurchaseHandler({
    amount,
    numericAmount,
    phoneNumber,
    selectedProvider,
    payment,
    customer,
    onSuccess,
    dismissKeyboard,
    returnToHref: walletReturnToHref,
  });

  const handlePaymentLayout = (event: LayoutChangeEvent) => {
    scrollToAirtimePaymentSection({
      event,
      scrollViewRef,
      setShouldScrollToPayment,
      shouldScrollToPayment,
    });
  };

  return {
    amount,
    footerBottomOffset: getUtilityFooterOffset({
      bottomInset: insets.bottom,
      isKeyboardVisible,
      keyboardHeight,
    }),
    footerSpacerHeight:
      FOOTER_HEIGHT + Math.max(insets.bottom, SPACING.md) + FOOTER_ERROR_BUFFER,
    formattedAmount: formatUtilityAmountInput(amount),
    handlePaymentLayout,
    handlePhoneChange,
    handleProviderSelect: (provider: string) => {
      setSelectedProvider(provider);
      setIsNetworkPickerExpanded(false);
    },
    handlePurchase,
    insets,
    isSubmitting,
    isKeyboardVisible,
    isNetworkPickerExpanded,
    numericAmount,
    payment,
    phoneNumber,
    scrollViewRef,
    selectedProvider,
    selectedProviderConfig,
    walletReturnToHref,
    setAmount: updateAmount,
    setIsNetworkPickerExpanded,
    isBeneficiarySelected,
    setIsBeneficiarySelected,
  };
}
