import React, { useRef } from 'react';
import { Platform } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { CheckoutBottomAction } from '@/components/checkout/CheckoutBottomAction';
import { CheckoutHeader } from '@/components/checkout/CheckoutHeader';
import { CheckoutStepContent } from '@/components/checkout/CheckoutStepContent';
import {
  type CheckoutStep,
  CheckoutStepper,
} from '@/components/checkout/CheckoutStepper';
import { PatternedBackground } from '@/components/storefront/PatternedBackground';
import AppKeyboardContainer from '@/components/ui/AppKeyboardContainer';
import { AddressSuggestionsProvider } from '@/components/ui/address-suggestions-portal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuthStatus } from '@/hooks/use-auth-guard';
import { useMerchant } from '@/hooks/use-merchant';
import type { MobileCheckoutIdempotencyState } from '@/lib/checkout-order-idempotency';
import { CheckoutLocationPickerOverlays } from './CheckoutLocationPickerOverlays';
import { CheckoutPaymentOverlays } from './CheckoutPaymentOverlays';
import { checkoutScreenViewStyles as styles } from './CheckoutScreenView.styles';
import { CheckoutSimulationBanner } from './CheckoutSimulationBanner';
import { calculateCheckoutAssuranceFee } from './checkout-order-builders';
import type { CheckoutScreenViewProps } from './checkout-prize-simulation.types';
import {
  CHECKOUT_MERCHANT_ID,
  CHECKOUT_MERCHANT_SLUG,
} from './checkout-screen.constants';
import type { AppliedDiscount } from './DiscountCodeInput';
import { isCheckoutAddressContinueReady } from './is-checkout-address-continue-ready';
import { getMerchantPickupLocation } from './merchant-pickup-location';
import { CheckoutDiscount } from './redvault/CheckoutDiscount';
import { getRedvaultCompatibleDiscount } from './redvault/get-redvault-compatible-discount';
import { RedvaultOrderReview } from './redvault/RedvaultOrderReview';
import { useCheckoutAddressState } from './use-checkout-address-state';
import { useCheckoutCryptoPayment } from './use-checkout-crypto-payment';
import { useCheckoutCtaAnimation } from './use-checkout-cta-animation';
import { useCheckoutDisplayCart } from './use-checkout-display-cart';
import { useCheckoutNavigation } from './use-checkout-navigation';
import { useCheckoutPaymentController } from './use-checkout-payment-controller';
import { useCheckoutStepActions } from './use-checkout-step-actions';
import { useRedvaultReview } from './use-redvault-review';

export function CheckoutScreenView({
  prizeSimulation,
}: CheckoutScreenViewProps = {}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = (colorScheme ?? 'light') === 'dark';
  const insets = useSafeAreaInsets();
  const { clearCart, items, subtotal } =
    useCheckoutDisplayCart(prizeSimulation);
  const { customer, isAuthenticated, user } = useAuthStatus();
  const { data: merchant } = useMerchant();
  const merchantPickupLocation = getMerchantPickupLocation(merchant);
  const [step, setStep] = React.useState<CheckoutStep>('address');
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [appliedDiscount, setAppliedDiscount] =
    React.useState<AppliedDiscount | null>(null);
  const isOrderInFlight = useRef(false);
  const mobileCheckoutIdempotencyRef =
    useRef<MobileCheckoutIdempotencyState | null>(null);
  const animatedCtaArrowStyle = useCheckoutCtaAnimation(isProcessing);
  const addressState = useCheckoutAddressState({
    analyticsEnabled: !prizeSimulation,
    customer,
    isAuthenticated,
    items,
    subtotal,
    user,
  });
  const {
    accountPassword,
    form,
    saveDetails,
    savedAddresses: savedAddressState,
    shipping,
    isAddressComplete,
    watchedCity,
    watchedState,
  } = addressState;
  const { handleSubmit, setValue } = form;
  const {
    currentShippingQuoteContextKey,
    deliveryFee,
    deliveryMethod,
    isCurrentQuoteContext,
    isLoadingQuotes,
    resolvedShippingQuoteContextKey,
    requiresShippingQuote,
    selectedQuote,
  } = shipping;
  const formContentPaddingBottom = 116 + insets.bottom;
  const {
    saveAsDefaultAddress,
    selectedSavedAddressId,
    setIsContactCollapsed,
    setIsDeliveryCollapsed,
  } = savedAddressState;
  const { handleBack } = useCheckoutNavigation({
    isOrderInFlight,
    isPrizeSimulation: Boolean(prizeSimulation),
    setStep,
    step,
  });
  const assuranceFee = calculateCheckoutAssuranceFee(items);
  const paymentController = useCheckoutPaymentController({
    assuranceFee,
    customerId: customer?.id,
    customerPhone: customer?.phone,
    deliveryFee,
    isAuthenticated,
    items,
    merchantId: merchant?.id || CHECKOUT_MERCHANT_ID,
    merchantSlug: CHECKOUT_MERCHANT_SLUG,
    step,
    subtotal,
  });
  const {
    availablePaymentMethods,
    displayTotal,
    orderTotals,
    paymentSettings,
    paymentTab,
    resetPaymentSelection,
    savings,
    selectedPayment,
    total,
    walletBalance,
    walletSelection,
  } = paymentController;
  const { getLiveSavingsSelection } = savings;
  const { closeRedvaultReview, openRedvaultReview, redvaultReview } =
    useRedvaultReview({
      resetPaymentSelection,
      setStep,
    });
  const crypto = useCheckoutCryptoPayment({
    isOrderInFlight,
    setIsProcessing,
    total,
  });
  const { setPendingOrder, setShowCryptoSelection } = crypto;
  const compatibleDiscount = getRedvaultCompatibleDiscount(
    selectedPayment,
    appliedDiscount
  );
  const { handleContinue, handlePlaceOrder } = useCheckoutStepActions({
    onRedvaultOrder: openRedvaultReview,
    accountPassword,
    appliedDiscountCode: compatibleDiscount?.code ?? null,
    availablePaymentMethods,
    clearCart,
    currentShippingQuoteContextKey,
    customer,
    deliveryFee,
    deliveryMethod,
    getLiveSavingsSelection,
    getShippingProvider: shipping.getShippingProvider,
    isAuthenticated,
    isLoadingQuotes,
    isOrderInFlight,
    isProcessing,
    isPrizeSimulation: Boolean(prizeSimulation),
    mobileCheckoutIdempotencyRef,
    merchantPickupLocation,
    onPrizeSimulationComplete: prizeSimulation?.onComplete,
    orderTotals,
    paymentSettings,
    paymentTab,
    resolvedShippingQuoteContextKey,
    requiresShippingQuote,
    resetPaymentSelection,
    saveAsDefaultAddress,
    saveDetails,
    selectedPayment,
    selectedQuote,
    selectedSavedAddressId,
    setIsProcessing,
    setPendingOrder,
    setShowCryptoSelection,
    setStep,
    user,
    walletBalance,
    walletFundedBankTransferOptionEnabled:
      paymentController.walletFundedBankTransferOptionEnabled,
    walletSelection,
    handleSubmit,
    setIsContactCollapsed,
    setIsDeliveryCollapsed,
    setValue,
    step,
  });
  return (
    <AddressSuggestionsProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <PatternedBackground
          backgroundColor={colors.background}
          isDark={isDark}
        />
        <CheckoutHeader colors={colors} onBack={handleBack} />
        <AppKeyboardContainer
          style={[styles.contentShell, { backgroundColor: 'transparent' }]}
        >
          {prizeSimulation ? (
            <CheckoutSimulationBanner colors={colors} />
          ) : null}
          <CheckoutStepper
            step={step}
            setStep={setStep}
            itemCount={items.reduce((acc, item) => acc + item.quantity, 0)}
            colors={colors}
            isDark={isDark}
            isPrizeSimulation={Boolean(prizeSimulation)}
          />
          <CheckoutStepContent
            addressState={addressState}
            assuranceFee={assuranceFee}
            colors={colors}
            formContentPaddingBottom={formContentPaddingBottom}
            isAuthenticated={isAuthenticated}
            isDark={isDark}
            items={items}
            merchantPickupLocation={merchantPickupLocation}
            paymentController={paymentController}
            prizeSimulation={Boolean(prizeSimulation)}
            setStep={setStep}
            step={step}
            subtotal={subtotal}
          />
          <CheckoutDiscount
            visible={
              step === 'payment' &&
              !prizeSimulation &&
              selectedPayment !== 'uba_redvault'
            }
            subtotal={subtotal}
            productIds={items.map((item) => item.product_id)}
            appliedDiscount={appliedDiscount}
            onChange={setAppliedDiscount}
          />
          <CheckoutBottomAction
            animatedCtaArrowStyle={animatedCtaArrowStyle}
            canContinue={
              step !== 'address'
                ? step !== 'payment' || selectedPayment !== null
                : isCheckoutAddressContinueReady({
                    hasSelectedShippingQuote: Boolean(selectedQuote),
                    hasContactIdentity: addressState.hasContactIdentity,
                    isAddressComplete,
                    isCurrentQuoteContext,
                    isLoadingQuotes,
                    isPickupStation: deliveryMethod === 'pickup_station',
                    requiresShippingQuote,
                  })
            }
            colors={colors}
            displayTotal={Math.max(
              0,
              displayTotal - (compatibleDiscount?.discountAmount ?? 0)
            )}
            insetsBottom={insets.bottom}
            isProcessing={isProcessing}
            itemCount={items.length}
            onContinue={handleContinue}
            onPlaceOrder={handlePlaceOrder}
            selectedPayment={selectedPayment}
            prizeSimulation={Boolean(prizeSimulation)}
            step={step}
            total={Math.max(
              0,
              total - (compatibleDiscount?.discountAmount ?? 0)
            )}
          />
        </AppKeyboardContainer>
      </SafeAreaView>
      <RedvaultOrderReview
        input={redvaultReview}
        onClose={closeRedvaultReview}
      />
      <CheckoutLocationPickerOverlays
        colors={colors}
        isDark={isDark}
        removeClippedSubviews={Platform.OS === 'android'}
        shipping={shipping}
        watchedCity={watchedCity}
        watchedState={watchedState}
      />
      <CheckoutPaymentOverlays
        crypto={crypto}
        clearCart={clearCart}
        colors={colors}
        isProcessing={isProcessing}
      />
    </AddressSuggestionsProvider>
  );
}
