import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import type { CheckoutIdentityTheme } from '../colors';
import { styles } from '../styles';

interface SecurityFooterProps {
  bottomInset: number;
  theme: CheckoutIdentityTheme;
}

export function SecurityFooter({ bottomInset, theme }: SecurityFooterProps) {
  return (
    <View
      style={[
        styles.footer,
        {
          backgroundColor: theme.sheet,
          borderTopColor: theme.border,
          paddingBottom: Math.max(bottomInset, 8),
        },
      ]}
      accessible={true}
      accessibilityRole="text"
      accessibilityLabel="Secure checkout"
    >
      <Ionicons
        name="shield-checkmark-outline"
        size={16}
        color={theme.primary}
        accessibilityElementsHidden={true}
        importantForAccessibility="no"
      />
      <Text style={[styles.footerText, { color: theme.footerText }]}>
        Secure checkout
      </Text>
    </View>
  );
}
