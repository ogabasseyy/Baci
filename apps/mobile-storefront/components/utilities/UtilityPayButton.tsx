import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { UtilityFormNotice } from './UtilityFormNotice';

interface UtilityPayButtonProps {
  /** Amount the purchase would charge; ₦0 or less can never succeed. */
  amount: number;
  /**
   * Why the purchase cannot go ahead yet (a missing or invalid field, or a
   * payment method that is known to be short). Disables the button.
   */
  blockedReason?: string | null;
  buttonStyle: StyleProp<ViewStyle>;
  isBusy: boolean;
  label: string;
  /** Calm notice shown above the button, such as the shortfall and its link. */
  notice?: {
    action?: { label: string; onPress: () => void } | null;
    message: string;
  } | null;
  onPress: () => void;
  textStyle: StyleProp<TextStyle>;
}

/**
 * Footer Pay button shared by the airtime, data and bill forms.
 *
 * It is disabled, and looks it, until there is an amount to pay and nothing
 * blocks the purchase (`blockedReason`). The form decides what blocks it: a
 * balance that is still loading or failed to load never does, so the submit
 * gate can say so, and a retry of an already-charged purchase (retained
 * replay) is never blocked by a short balance.
 */
export function UtilityPayButton({
  amount,
  blockedReason = null,
  buttonStyle,
  isBusy,
  label,
  notice = null,
  onPress,
  textStyle,
}: UtilityPayButtonProps) {
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const isBlocked = !hasAmount || Boolean(blockedReason);
  const isDisabled = isBusy || isBlocked;

  return (
    <>
      {notice ? (
        <UtilityFormNotice action={notice.action} message={notice.message} />
      ) : null}
      <Pressable
        style={[
          buttonStyle,
          {
            backgroundColor: isBlocked ? palette.gray[300] : BRAND.primary,
            opacity: isBusy ? 0.7 : 1,
          },
        ]}
        onPress={onPress}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={
          blockedReason ?? (hasAmount ? undefined : 'Enter an amount to pay')
        }
        accessibilityState={{ busy: isBusy, disabled: isDisabled }}
      >
        {isBusy ? (
          <ActivityIndicator color={BRAND.onPrimary} />
        ) : (
          <Text
            style={[textStyle, isBlocked ? { color: palette.gray[600] } : null]}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </>
  );
}
