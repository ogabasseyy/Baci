import React, { useRef } from 'react';
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
import { useCartCheckoutSnapshot } from '@/hooks/use-cart-checkout-snapshot';
import { useMerchant } from '@/hooks/use-merchant';
import type { MobileCheckoutIdempotencyState } from '@/lib/checkout-order-idempotency';
import { CartCheckoutReviewNotice } from './CartCheckoutReviewNotice';
import { CheckoutOverlays } from './CheckoutOverlays';
import { checkoutScreenViewStyles as styles } from './CheckoutScreenView.styles';
import { CheckoutSimulationBanner } from './CheckoutSimulationBanner';
import type { CheckoutScreenViewProps } from './checkout-prize-simulation.types';
import type { AppliedDiscount } from './DiscountCodeInput';
import { isCheckoutContinueReady } from './is-checkout-address-continue-ready';
import { getMerchantPickupLocation } from './merchant-pickup-location';
import { CheckoutDiscount } from './redvault/CheckoutDiscount';
import {
  discountedCheckoutTotal,
  getRedvaultCompatibleDiscount,
} from './redvault/get-redvault-compatible-discount';
import { useCheckoutAddressState } from './use-checkout-address-state';
import { useCheckoutCryptoPayment } from './use-checkout-crypto-payment';
import { useCheckoutCtaAnimation } from './use-checkout-cta-animation';
import { useCheckoutDisplayCart } from './use-checkout-display-cart';
import { useCheckoutNavigation } from './use-checkout-navigation';
import { useCheckoutScreenPayment } from './use-checkout-screen-payment';
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
  // Canonical preparation/review for shared-cart devices; preparation
  // never submits an order, and the submit path refuses stale reviews.
  const cartReview = useCartCheckoutSnapshot();
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
  const {
    assuranceFee,
    availablePaymentMethods,
    displayTotal,
    orderTotals,
    paymentController,
    paymentSettings,
    paymentTab,
    resetPaymentSelection,
    savings,
    selectedPayment,
    total,
    walletBalance,
    walletSelection,
  } = useCheckoutScreenPayment({
    customerId: customer?.id,
    customerPhone: customer?.phone,
    deliveryFee,
    isAuthenticated,
    items,
    merchantId: merchant?.id,
    step,
    subtotal,
    userId: user?.id,
  });
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
          <CartCheckoutReviewNotice
            status={cartReview.status}
            review={cartReview.review}
            onRetry={cartReview.retry}
            textColor={colors.text}
          />
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
            canContinue={isCheckoutContinueReady({
              step,
              selectedPayment,
              hasSelectedShippingQuote: Boolean(selectedQuote),
              hasContactIdentity: addressState.hasContactIdentity,
              isAddressComplete,
              isCurrentQuoteContext,
              isLoadingQuotes,
              isPickupStation: deliveryMethod === 'pickup_station',
              requiresShippingQuote,
            })}
            colors={colors}
            displayTotal={discountedCheckoutTotal(
              displayTotal,
              compatibleDiscount
            )}
            insetsBottom={insets.bottom}
            isProcessing={isProcessing}
            itemCount={items.length}
            onContinue={handleContinue}
            onPlaceOrder={handlePlaceOrder}
            selectedPayment={selectedPayment}
            prizeSimulation={Boolean(prizeSimulation)}
            step={step}
            total={discountedCheckoutTotal(total, compatibleDiscount)}
          />
        </AppKeyboardContainer>
      </SafeAreaView>
      <CheckoutOverlays
        redvaultReview={redvaultReview}
        closeRedvaultReview={closeRedvaultReview}
        colors={colors}
        isDark={isDark}
        shipping={shipping}
        watchedCity={watchedCity}
        watchedState={watchedState}
        crypto={crypto}
        clearCart={clearCart}
        isProcessing={isProcessing}
      />
    </AddressSuggestionsProvider>
  );
}
