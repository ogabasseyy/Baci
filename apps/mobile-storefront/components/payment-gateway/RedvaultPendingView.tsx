import { Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';

export function RedvaultPendingView({
  colors,
  held,
  onCheck,
  onViewOrders,
}: {
  colors: typeof Colors.light;
  held: boolean;
  onCheck: () => void;
  onViewOrders: () => void;
}) {
  return (
    <View style={{ padding: 24, gap: 20 }}>
      <Text accessibilityRole="alert" style={{ color: colors.text }}>
        {held
          ? 'Your payment has been received and is awaiting verification. Do not pay again.'
          : 'Your UBA payment status is still being checked. A charge has not been confirmed. Do not pay again.'}
      </Text>
      <Pressable accessibilityRole="button" onPress={onCheck}>
        <Text style={{ color: colors.primary }}>Check payment status</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onViewOrders}>
        <Text style={{ color: colors.primary }}>View your orders</Text>
      </Pressable>
    </View>
  );
}
