import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { OxygenCheckoutScreen } from '@/components/oxygen-checkout/OxygenCheckoutScreen';
import { useOxygenColors } from '@/components/oxygen-checkout/OxygenFormPrimitives';
import { OxygenAction } from '@/components/oxygen-checkout/oxygen-presentation';

export default function OxygenCheckoutRoute() {
  const colors = useOxygenColors();
  const { orderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const parsed = z.uuid().safeParse(orderId);
  return parsed.success ? (
    <OxygenCheckoutScreen orderId={parsed.data} />
  ) : (
    <SafeAreaView
      edges={['left', 'right', 'bottom']}
      style={{
        flex: 1,
        gap: 16,
        padding: 20,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ color: colors.text }}>
        Open a saved Oxygen order from your order history.
      </Text>
      <OxygenAction
        label="View my orders"
        onPress={() => router.replace('/orders')}
      />
    </SafeAreaView>
  );
}
