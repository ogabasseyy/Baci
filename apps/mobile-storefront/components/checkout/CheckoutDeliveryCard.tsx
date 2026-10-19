import { Controller } from 'react-hook-form';
import { View } from 'react-native';
import { AddressAutocomplete } from '@/components/ui/AddressAutocomplete';
import { checkoutDeliveryCardStyles as styles } from './CheckoutDeliveryCard.styles';
import type { CheckoutDeliveryCardProps } from './CheckoutDeliveryCard.types';
import { CheckoutDeliveryDefaultCheckbox } from './CheckoutDeliveryDefaultCheckbox';
import { CheckoutDeliveryLocationPicker } from './CheckoutDeliveryLocationPicker';
import { CheckoutDeliveryNewAddressIntro } from './CheckoutDeliveryNewAddressIntro';
import { CheckoutDeliverySummary } from './CheckoutDeliverySummary';
import { SavedAddressOptions } from './SavedAddressOptions';
import { CollapsibleCheckoutCard } from './selection/CollapsibleCheckoutCard';

export function CheckoutDeliveryCard({
  colors,
  control,
  currentDeliverySummary,
  defaultSavedAddress,
  errors,
  hasSavedAddresses,
  isAddingNewAddress,
  isAuthenticated,
  isCollapsed,
  isDark,
  isLoadingCities,
  isLoadingLocations,
  isLoadingSavedAddresses,
  onAddressSelected,
  onAddressTextChanged,
  onOpenCityPicker,
  onOpenNewAddressEditor,
  onOpenStatePicker,
  onToggleCollapsed,
  onToggleSaveAsDefaultAddress,
  onUseSavedAddress,
  saveAsDefaultAddress,
  savedAddresses,
  selectedSavedAddress,
  selectedSavedAddressId,
  showLocationPickers,
}: CheckoutDeliveryCardProps) {
  const showCollapseAction =
    hasSavedAddresses || Boolean(currentDeliverySummary);

  return (
    <CollapsibleCheckoutCard
      icon="location-outline"
      title="Delivery"
      colors={colors}
      isDark={isDark}
      collapsed={showCollapseAction && isCollapsed}
      canCollapse={showCollapseAction}
      onToggle={onToggleCollapsed}
      summary={
        <CheckoutDeliverySummary
          colors={colors}
          currentDeliverySummary={currentDeliverySummary}
          isDark={isDark}
          selectedSavedAddress={selectedSavedAddress}
        />
      }
    >
      <View style={styles.cardBody}>
        <SavedAddressOptions
          colors={colors}
          defaultSavedAddress={defaultSavedAddress}
          isAddingNewAddress={isAddingNewAddress}
          isDark={isDark}
          isLoadingSavedAddresses={isLoadingSavedAddresses}
          onOpenNewAddressEditor={onOpenNewAddressEditor}
          onUseSavedAddress={onUseSavedAddress}
          savedAddresses={savedAddresses}
          selectedSavedAddress={selectedSavedAddress}
          selectedSavedAddressId={selectedSavedAddressId}
        />
        {hasSavedAddresses && !isAddingNewAddress ? (
          isAuthenticated ? (
            <CheckoutDeliveryDefaultCheckbox
              checked={saveAsDefaultAddress}
              colors={colors}
              label={
                selectedSavedAddress?.is_default
                  ? 'Keep as default address'
                  : 'Make selected address my default'
              }
              onToggle={onToggleSaveAsDefaultAddress}
            />
          ) : null
        ) : (
          <>
            {hasSavedAddresses ? (
              <CheckoutDeliveryNewAddressIntro
                colors={colors}
                isDark={isDark}
              />
            ) : null}
            <Controller
              control={control}
              name="address"
              render={({ field: { onChange, value } }) => (
                <AddressAutocomplete
                  label="Street Address"
                  onChangeText={(text) => onAddressTextChanged(text, onChange)}
                  onSelect={(place) => onAddressSelected(place, onChange)}
                  placeholder="Start typing your address…"
                  value={value}
                />
              )}
            />
            {showLocationPickers ? (
              <View style={styles.row}>
                <CheckoutDeliveryLocationPicker
                  colors={colors}
                  control={control}
                  error={errors.city?.message}
                  isDark={isDark}
                  isLoading={isLoadingCities}
                  label="City"
                  onPress={onOpenCityPicker}
                  placeholder="Select city"
                  valueName="city"
                />
                <CheckoutDeliveryLocationPicker
                  colors={colors}
                  control={control}
                  error={errors.state?.message}
                  isDark={isDark}
                  isLoading={isLoadingLocations}
                  label="State"
                  onPress={onOpenStatePicker}
                  placeholder="Select state"
                  valueName="state"
                />
              </View>
            ) : null}
            {isAuthenticated ? (
              <CheckoutDeliveryDefaultCheckbox
                checked={saveAsDefaultAddress}
                colors={colors}
                label="Set as default address"
                onToggle={onToggleSaveAsDefaultAddress}
              />
            ) : null}
          </>
        )}
      </View>
    </CollapsibleCheckoutCard>
  );
}
