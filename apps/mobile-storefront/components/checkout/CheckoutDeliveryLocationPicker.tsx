import Ionicons from '@react-native-vector-icons/ionicons';
import type { Control } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { palette } from '@/constants/Colors';
import type { ShippingAddressInput } from '@/lib/validation';
import { checkoutDeliveryCardStyles as styles } from './CheckoutDeliveryCard.styles';
import type { CheckoutDeliveryCardColors } from './CheckoutDeliveryCard.types';
import { getLocationPickerError } from './location-picker-error';

/** Matches the theme `error` token: red 500 in light, red 400 in dark. */
function getPickerErrorColor(isDark: boolean): string {
  return isDark ? palette.red[400] : palette.red[500];
}

type CheckoutDeliveryLocationPickerProps = {
  colors: CheckoutDeliveryCardColors;
  control: Control<ShippingAddressInput>;
  error?: string;
  isDark: boolean;
  isLoading: boolean;
  label: string;
  onPress: () => void;
  placeholder: string;
  valueName: 'city' | 'state';
};

export function CheckoutDeliveryLocationPicker({
  colors,
  control,
  error,
  isDark,
  isLoading,
  label,
  onPress,
  placeholder,
  valueName,
}: CheckoutDeliveryLocationPickerProps) {
  const loadingLabel =
    valueName === 'city' ? 'Loading cities' : 'Loading states';
  const pickerLabel = isLoading
    ? `Select ${valueName}, loading`
    : `Select ${valueName}`;

  return (
    <View style={styles.halfInput}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Controller
        control={control}
        name={valueName}
        render={({ field: { value } }) => {
          const displayError = getLocationPickerError(valueName, value, error);
          return (
            <>
              <Pressable
                accessibilityHint={isLoading ? 'Loading options' : undefined}
                accessibilityLabel={pickerLabel}
                accessibilityRole="button"
                accessibilityState={{ busy: isLoading }}
                onPress={onPress}
                style={[
                  styles.input,
                  styles.selectInput,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255, 255, 255, 0.05)'
                      : '#F9FAFB',
                    borderColor: displayError
                      ? getPickerErrorColor(isDark)
                      : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.selectInputText,
                    {
                      color: value ? colors.text : colors.textSecondary,
                    },
                  ]}
                >
                  {value || placeholder}
                </Text>
                {isLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.textSecondary}
                    accessibilityLabel={loadingLabel}
                    accessibilityRole="progressbar"
                    testID={`checkout-delivery-${valueName}-loading`}
                  />
                ) : (
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={colors.textSecondary}
                  />
                )}
              </Pressable>
              {displayError ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.fieldError,
                    { color: getPickerErrorColor(isDark) },
                  ]}
                >
                  {displayError}
                </Text>
              ) : null}
            </>
          );
        }}
      />
    </View>
  );
}
