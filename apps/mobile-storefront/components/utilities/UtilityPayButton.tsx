import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';

interface UtilityPayButtonProps {
  /** Amount the purchase would charge; ₦0 or less can never succeed. */
  amount: number;
  buttonStyle: StyleProp<ViewStyle>;
  isBusy: boolean;
  label: string;
  onPress: () => void;
  textStyle: StyleProp<TextStyle>;
}

/**
 * Footer Pay button shared by the airtime, data and bill forms.
 *
 * It is disabled, and looks it, until there is an amount to pay. It stays
 * pressable when the wallet balance looks short: the submit gate then either
 * opens the top-up prompt or lets a retry of an already-charged purchase
 * through (retained replay), and that check needs the press-time request, so
 * it cannot be judged here.
 */
export function UtilityPayButton({
  amount,
  buttonStyle,
  isBusy,
  label,
  onPress,
  textStyle,
}: UtilityPayButtonProps) {
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const isDisabled = isBusy || !hasAmount;

  return (
    <Pressable
      style={[
        buttonStyle,
        {
          backgroundColor: hasAmount ? BRAND.primary : palette.gray[300],
          opacity: isBusy ? 0.7 : 1,
        },
      ]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hasAmount ? undefined : 'Enter an amount to pay'}
      accessibilityState={{ busy: isBusy, disabled: isDisabled }}
    >
      {isBusy ? (
        <ActivityIndicator color={BRAND.onPrimary} />
      ) : (
        <Text
          style={[textStyle, hasAmount ? null : { color: palette.gray[600] }]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
