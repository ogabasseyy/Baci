import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { styles } from './payment-methods.styles';

interface PaymentMethodsFooterProps {
  colors: ThemeColors;
  onManagePayments: () => void;
}

/** Displays dashboard guidance and links to web payment gateway settings. */
export function PaymentMethodsFooter({
  colors,
  onManagePayments,
}: PaymentMethodsFooterProps) {
  return (
    <>
      <View
        style={[
          styles.notice,
          { backgroundColor: colors.infoLight || '#EFF6FF' },
        ]}
      >
        <Ionicons
          name="information-circle"
          size={20}
          color={colors.info || '#3B82F6'}
        />
        <Text style={[styles.noticeText, { color: colors.info || '#3B82F6' }]}>
          API keys and webhook configuration available on web dashboard.
        </Text>
      </View>

      <Pressable
        style={[styles.manageButton, { backgroundColor: colors.primary }]}
        onPress={onManagePayments}
      >
        <Ionicons
          name="settings-outline"
          size={20}
          color={colors.textOnPrimary}
        />
        <Text
          style={[styles.manageButtonText, { color: colors.textOnPrimary }]}
        >
          Advanced Settings
        </Text>
      </Pressable>
    </>
  );
}
