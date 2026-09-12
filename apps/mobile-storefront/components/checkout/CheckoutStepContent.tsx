import { CheckoutAddressStepView } from '@/components/checkout/CheckoutAddressStepView';
import { CheckoutPaymentStepView } from '@/components/checkout/CheckoutPaymentStepView';
import { CheckoutReviewStep } from '@/components/checkout/CheckoutReviewStep';
import type { CheckoutStep } from '@/components/checkout/CheckoutStepper';
import type Colors from '@/constants/Colors';
import { getMerchantTaxRate } from '@/hooks/useMerchantPaymentSettings';
import type { CartItem } from '@/stores/cart-store';
import type { MerchantPickupLocation } from './merchant-pickup-location';
import type { CheckoutAddressState } from './use-checkout-address-state';
import type { CheckoutPaymentController } from './use-checkout-payment-controller';

type ColorsScheme = (typeof Colors)['light'];

interface CheckoutStepContentProps {
  addressState: CheckoutAddressState;
  assuranceFee: number;
  colors: ColorsScheme;
  formContentPaddingBottom: number;
  isAuthenticated: boolean;
  isDark: boolean;
  items: CartItem[];
  merchantPickupLocation?: MerchantPickupLocation;
  paymentController: CheckoutPaymentController;
  prizeSimulation?: boolean;
  setStep: (step: CheckoutStep) => void;
  step: CheckoutStep;
  subtotal: number;
}

export function CheckoutStepContent({
  addressState,
  assuranceFee,
  colors,
  formContentPaddingBottom,
  isAuthenticated,
  isDark,
  items,
  merchantPickupLocation,
  paymentController,
  prizeSimulation = false,
  setStep,
  step,
  subtotal,
}: CheckoutStepContentProps) {
  if (step === 'address') {
    return (
      <CheckoutAddressStepView
        accountPassword={addressState.accountPassword}
        colors={colors}
        contactSummary={addressState.currentContactSummary}
        control={addressState.form.control}
        currentDeliverySummary={addressState.currentDeliverySummary}
        defaultSavedAddress={addressState.savedAddresses.defaultSavedAddress}
        deliveryMethod={addressState.shipping.deliveryMethod}
        errors={addressState.form.formState.errors}
        formContentPaddingBottom={formContentPaddingBottom}
        hasContactIdentity={addressState.hasContactIdentity}
        hasSavedAddresses={addressState.savedAddresses.hasSavedAddresses}
        isAddingNewAddress={addressState.savedAddresses.isAddingNewAddress}
        isAuthenticated={isAuthenticated}
        isContactCollapsed={addressState.savedAddresses.isContactCollapsed}
        isDark={isDark}
        isDeliveryCollapsed={addressState.savedAddresses.isDeliveryCollapsed}
        isLoadingCities={addressState.shipping.isLoadingCities}
        isLoadingLocations={addressState.shipping.isLoadingLocations}
        isLoadingQuotes={addressState.shipping.isLoadingQuotes}
        isLoadingSavedAddresses={
          addressState.savedAddresses.isLoadingSavedAddresses
        }
        merchantPickupLocation={merchantPickupLocation}
        onAddressSelected={addressState.shipping.handleDeliveryAddressSelect}
        onAddressTextChanged={
          addressState.shipping.handleDeliveryAddressTextChange
        }
        onChangeAccountPassword={addressState.setAccountPassword}
        onContactEmailSettled={addressState.settleContactEmail}
        onOpenCityPicker={() => addressState.shipping.setShowCityPicker(true)}
        onOpenNewAddressEditor={addressState.openNewAddressEditor}
        onOpenStatePicker={() => addressState.shipping.setShowStatePicker(true)}
        onRetryQuotes={addressState.shipping.handleRetryShippingQuotes}
        onSelectDeliveryMethod={
          addressState.shipping.handleSelectDeliveryMethod
        }
        onSelectQuote={addressState.shipping.setSelectedQuoteId}
        onToggleContactCollapsed={() => {
          // Single-open accordion: expanding Contact folds Delivery to its
          // (dark) summary, so only the section you're working on is open.
          const expanding = addressState.savedAddresses.isContactCollapsed;
          addressState.savedAddresses.setIsContactCollapsed(!expanding);
          if (expanding) {
            addressState.savedAddresses.setIsDeliveryCollapsed(true);
          }
        }}
        onToggleDeliveryCollapsed={() => {
          const expanding = addressState.savedAddresses.isDeliveryCollapsed;
          addressState.savedAddresses.setIsDeliveryCollapsed(!expanding);
          if (expanding) {
            addressState.savedAddresses.setIsContactCollapsed(true);
          }
        }}
        onToggleSaveAsDefaultAddress={() =>
          addressState.savedAddresses.setSaveAsDefaultAddress((value) => !value)
        }
        onToggleSaveDetails={() =>
          addressState.setSaveDetails(!addressState.saveDetails)
        }
        onUseSavedAddress={addressState.savedAddresses.applySavedAddressToForm}
        phone={addressState.watchedPhone}
        saveAsDefaultAddress={addressState.savedAddresses.saveAsDefaultAddress}
        saveDetails={addressState.saveDetails}
        savedAddresses={addressState.savedAddresses.savedAddresses}
        selectedQuote={addressState.shipping.selectedQuote}
        selectedQuoteId={addressState.shipping.selectedQuoteId}
        selectedSavedAddress={addressState.savedAddresses.selectedSavedAddress}
        selectedSavedAddressId={
          addressState.savedAddresses.selectedSavedAddressId
        }
        shippingQuotes={addressState.shipping.shippingQuotes}
        showLocationPickers={addressState.shipping.showLocationPickers}
        watchedCity={addressState.watchedCity}
        watchedEmail={addressState.watchedEmail}
        watchedState={addressState.watchedState}
      />
    );
  }

  if (step === 'payment') {
    return (
      <CheckoutPaymentStepView
        availablePaymentMethods={paymentController.availablePaymentMethods}
        checkoutSavingsBalance={
          paymentController.savings.checkoutSavingsBalance
        }
        checkoutSavingsError={paymentController.savings.checkoutSavingsError}
        checkoutSavingsGoal={paymentController.savings.checkoutSavingsGoal}
        colors={colors}
        formContentPaddingBottom={formContentPaddingBottom}
        hiddenPaymentMethods={paymentController.hiddenPaymentMethods}
        isDark={isDark}
        isLoadingCheckoutSavings={
          paymentController.savings.isLoadingCheckoutSavings
        }
        klumpDisabledReason={paymentController.klumpDisabledReason}
        onRetrySavings={paymentController.savings.reloadCheckoutSavings}
        onSavingsToggle={paymentController.savings.setSavingsSelection}
        onSelectPayment={paymentController.setSelectedPayment}
        onSelectPaymentTab={paymentController.handleSelectPaymentTab}
        onWalletToggle={paymentController.setWalletSelection}
        paymentTab={paymentController.paymentTab}
        savingsSelection={paymentController.savings.savingsSelection}
        selectedPayment={paymentController.selectedPayment}
        total={paymentController.total}
        walletBalance={paymentController.walletBalance}
        walletFundedBankTransferOptionEnabled={
          paymentController.walletFundedBankTransferOptionEnabled
        }
        walletSelection={paymentController.walletSelection}
      />
    );
  }

  return (
    <CheckoutReviewStep
      address={addressState.form.getValues()}
      assuranceFee={assuranceFee}
      colors={colors}
      deliveryFee={addressState.shipping.deliveryFee}
      deliveryMethod={addressState.shipping.deliveryMethod}
      formContentPaddingBottom={formContentPaddingBottom}
      isDark={isDark}
      items={items}
      merchantPickupLocation={merchantPickupLocation}
      onEditAddress={() => setStep('address')}
      onEditPayment={() => setStep('payment')}
      prizeSimulation={prizeSimulation}
      selectedPayment={paymentController.selectedPayment}
      selectedQuote={addressState.shipping.selectedQuote}
      subtotal={subtotal}
      taxAmount={paymentController.orderTotals?.taxAmount ?? null}
      taxRate={getMerchantTaxRate(paymentController.paymentSettings)}
      total={paymentController.total}
    />
  );
}
