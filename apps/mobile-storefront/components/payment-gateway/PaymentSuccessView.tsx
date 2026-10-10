import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  PAYMENT_KINDS,
  type PaymentKind,
} from '@/components/payment-gateway/payment-gateway.helpers';
import { paymentGatewayStyles as styles } from '@/components/payment-gateway/payment-gateway.styles';
import type Colors from '@/constants/Colors';
import { withAlpha } from '@/constants/Colors';

interface PaymentSuccessViewProps {
  colors: typeof Colors.light;
  paymentKind?: PaymentKind;
}

function getRedirectMessage(paymentKind?: PaymentKind) {
  switch (paymentKind) {
    case PAYMENT_KINDS.VTU:
      return 'Redirecting to your utility confirmation...';
    case PAYMENT_KINDS.WALLET:
    case PAYMENT_KINDS.PRIMARY_WALLET_CARD:
      return 'Redirecting to your wallet...';
    default:
      return 'Redirecting to your order confirmation...';
  }
}

export function PaymentSuccessView({
  colors,
  paymentKind,
}: PaymentSuccessViewProps) {
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={styles.centeredContainer}
      >
        <View
          style={[
            styles.statusIcon,
            { backgroundColor: withAlpha(colors.success, 0.125) },
          ]}
        >
          <Ionicons
            accessibilityLabel="Payment successful"
            name="checkmark-circle"
            size={48}
            color={colors.success}
          />
        </View>
        <Text style={[styles.statusTitle, { color: colors.text }]}>
          Payment Successful!
        </Text>
        <Text style={[styles.statusMessage, { color: colors.textSecondary }]}>
          {getRedirectMessage(paymentKind)}
        </Text>
        <ActivityIndicator
          accessibilityLabel="Redirecting after payment success"
          size="small"
          color={colors.primary}
          style={styles.activityIndicator}
        />
      </View>
    </View>
  );
}
