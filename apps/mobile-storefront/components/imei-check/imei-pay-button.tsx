import Ionicons, {
  type IoniconsIconName,
} from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { footerStyles } from './imei-check-footer.styles';

/** The footer's one full-width pill button: verify, pay or top up. */
export function ImeiPayButton({
  busy,
  disabled,
  icon,
  label,
  onPress,
}: {
  busy: boolean;
  disabled: boolean;
  icon: IoniconsIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      style={[
        footerStyles.payButton,
        { backgroundColor: BRAND.primary },
        disabled && footerStyles.payButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {busy ? (
        <ActivityIndicator color={BRAND.onPrimary} />
      ) : (
        <>
          <Ionicons name={icon} size={18} color={BRAND.onPrimary} />
          <Text
            style={[footerStyles.payButtonText, { color: BRAND.onPrimary }]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
