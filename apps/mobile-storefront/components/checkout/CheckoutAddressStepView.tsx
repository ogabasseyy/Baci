import { ScrollView, Text, View } from 'react-native';
import { CheckoutContactCard } from '@/components/checkout/CheckoutContactCard';
import { CheckoutDeliveryCard } from '@/components/checkout/CheckoutDeliveryCard';
import { CheckoutFormField } from '@/components/checkout/CheckoutFormField';
import {
  AIRPORT_DELIVERY_ESTIMATE,
  AIRPORT_DELIVERY_FEE,
  getDeliveryMethodSummary,
  LAGOS_ROAD_DELIVERY_ESTIMATE,
} from '@/components/checkout/checkout-step-helpers';
import { DeliveryMethodCard } from '@/components/checkout/DeliveryMethodCard';
import { DeliveryNotesCard } from '@/components/checkout/DeliveryNotesCard';
import { PickupLocationOptions } from '@/components/checkout/PickupLocationOptions';
import { ShippingQuotesCard } from '@/components/checkout/ShippingQuotesCard';
import type { CheckoutAddressStepViewProps } from './CheckoutAddressStepView.types';
import { checkoutScreenViewStyles as styles } from './CheckoutScreenView.styles';
import { getCheckoutAddressShippingOptions } from './checkout-address-shipping-options';
import { MERCHANT_PICKUP_QUOTE_ID } from './merchant-pickup-location';

export function CheckoutAddressStepView({
  accountPassword,
  colors,
  contactSummary,
  control,
  currentDeliverySummary,
  defaultSavedAddress,
  deliveryMethod,
  errors,
  formContentPaddingBottom,
  hasContactIdentity,
  hasSavedAddresses,
  isAddingNewAddress,
  isAuthenticated,
  isContactCollapsed,
  isDark,
  isDeliveryCollapsed,
  isLoadingCities,
  isLoadingLocations,
  isLoadingQuotes,
  isLoadingSavedAddresses,
  merchantPickupLocation,
  onAddressSelected,
  onAddressTextChanged,
  onChangeAccountPassword,
  onContactEmailSettled,
  onOpenCityPicker,
  onOpenNewAddressEditor,
  onOpenStatePicker,
  onRetryQuotes,
  onSelectDeliveryMethod,
  onSelectQuote,
  onToggleContactCollapsed,
  onToggleDeliveryCollapsed,
  onToggleSaveAsDefaultAddress,
  onToggleSaveDetails,
  onUseSavedAddress,
  phone,
  saveAsDefaultAddress,
  saveDetails,
  savedAddresses,
  selectedQuote,
  selectedQuoteId,
  selectedSavedAddress,
  selectedSavedAddressId,
  shippingQuotes,
  showLocationPickers,
  watchedCity,
  watchedEmail,
  watchedState,
}: CheckoutAddressStepViewProps) {
  const canChooseDeliveryMethod = Boolean(watchedState && watchedCity);
  const {
    airShippingQuotes,
    doorSelectedQuote,
    doorShippingQuotes,
    effectiveSelectedQuoteId,
    localAirportQuote,
    providerPickupQuotes,
    stationPickupQuote,
    usesMerchantPickup,
  } = getCheckoutAddressShippingOptions({
    deliveryMethod,
    selectedQuote,
    selectedQuoteId,
    shippingQuotes,
    watchedCity,
    watchedState,
  });
  const shouldShowShippingQuotes =
    (deliveryMethod === 'door' || deliveryMethod === 'airport') &&
    Boolean(watchedState && watchedCity);
  return (
    <ScrollView
      style={styles.formContainer}
      contentContainerStyle={[
        styles.formContent,
        { paddingBottom: formContentPaddingBottom },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Delivery Address
        </Text>
        <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
          {hasContactIdentity
            ? 'Choose how this order should be delivered.'
            : 'Complete your contact details to unlock delivery options.'}
        </Text>
      </View>

      <CheckoutContactCard
        accountPassword={accountPassword}
        colors={colors}
        contactSummary={contactSummary}
        control={control}
        email={watchedEmail}
        errors={errors}
        hasContactIdentity={hasContactIdentity}
        isAuthenticated={isAuthenticated}
        isCollapsed={isContactCollapsed}
        isDark={isDark}
        onChangeAccountPassword={onChangeAccountPassword}
        onContactEmailSettled={onContactEmailSettled}
        onToggleCollapsed={onToggleContactCollapsed}
        onToggleSaveDetails={onToggleSaveDetails}
        phone={phone}
        saveDetails={saveDetails}
      />

      {hasContactIdentity ? (
        <>
          {deliveryMethod !== 'pickup_station' && (
            <CheckoutDeliveryCard
              colors={colors}
              control={control}
              currentDeliverySummary={currentDeliverySummary}
              defaultSavedAddress={defaultSavedAddress}
              errors={errors}
              hasSavedAddresses={hasSavedAddresses}
              isAddingNewAddress={isAddingNewAddress}
              isAuthenticated={isAuthenticated}
              isCollapsed={isDeliveryCollapsed}
              isDark={isDark}
              isLoadingCities={isLoadingCities}
              isLoadingLocations={isLoadingLocations}
              isLoadingSavedAddresses={isLoadingSavedAddresses}
              showLocationPickers={showLocationPickers}
              onAddressSelected={onAddressSelected}
              onAddressTextChanged={onAddressTextChanged}
              onOpenCityPicker={onOpenCityPicker}
              onOpenNewAddressEditor={onOpenNewAddressEditor}
              onOpenStatePicker={onOpenStatePicker}
              onToggleCollapsed={onToggleDeliveryCollapsed}
              onToggleSaveAsDefaultAddress={onToggleSaveAsDefaultAddress}
              onUseSavedAddress={onUseSavedAddress}
              saveAsDefaultAddress={saveAsDefaultAddress}
              savedAddresses={savedAddresses}
              selectedSavedAddress={selectedSavedAddress}
              selectedSavedAddressId={selectedSavedAddressId}
            />
          )}

          {canChooseDeliveryMethod && (
            <DeliveryMethodCard
              colors={colors}
              isDark={isDark}
              selectedMethod={deliveryMethod}
              onSelectMethod={onSelectDeliveryMethod}
              deliveryCity={watchedCity}
              deliveryState={watchedState}
              doorSubtitle={
                doorSelectedQuote != null
                  ? getDeliveryMethodSummary(
                      'door',
                      doorSelectedQuote,
                      watchedState
                    )
                  : 'Rates loaded after you enter your address'
              }
              airportFee={AIRPORT_DELIVERY_FEE}
              hasGiglGoFasterQuote={airShippingQuotes.length > 0}
              pickupStationQuote={stationPickupQuote}
              merchantPickupLocation={merchantPickupLocation}
            >
              {deliveryMethod === 'pickup_station' ? (
                <PickupLocationOptions
                  colors={colors}
                  isDark={isDark}
                  isLoading={isLoadingQuotes}
                  merchantLocation={
                    usesMerchantPickup ? merchantPickupLocation : undefined
                  }
                  onRetry={onRetryQuotes}
                  onSelect={onSelectQuote}
                  providerQuotes={providerPickupQuotes}
                  selectedQuoteId={
                    selectedQuoteId ||
                    (usesMerchantPickup && merchantPickupLocation
                      ? MERCHANT_PICKUP_QUOTE_ID
                      : '')
                  }
                />
              ) : shouldShowShippingQuotes ? (
                <ShippingQuotesCard
                  embedded
                  colors={colors}
                  estimateOverride={
                    deliveryMethod === 'airport'
                      ? AIRPORT_DELIVERY_ESTIMATE
                      : watchedState.trim().toLowerCase() === 'lagos'
                        ? LAGOS_ROAD_DELIVERY_ESTIMATE
                        : undefined
                  }
                  isDark={isDark}
                  isLoadingQuotes={isLoadingQuotes}
                  shippingQuotes={
                    deliveryMethod === 'airport'
                      ? [
                          ...(localAirportQuote ? [localAirportQuote] : []),
                          ...airShippingQuotes,
                        ]
                      : doorShippingQuotes
                  }
                  stationPickupQuote={stationPickupQuote}
                  selectedQuoteId={effectiveSelectedQuoteId}
                  onSelectQuote={onSelectQuote}
                  onRetryQuotes={onRetryQuotes}
                />
              ) : undefined}
            </DeliveryMethodCard>
          )}

          <DeliveryNotesCard colors={colors} isDark={isDark}>
            <CheckoutFormField
              name="notes"
              label=""
              placeholder="Any special instructions for delivery"
              multiline
              control={control}
              errors={errors}
              colors={colors}
              isDark={isDark}
            />
          </DeliveryNotesCard>
        </>
      ) : null}
    </ScrollView>
  );
}
