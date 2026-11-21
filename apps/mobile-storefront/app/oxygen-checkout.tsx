import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { z } from 'zod';
import { OxygenCheckoutScreen } from '@/components/oxygen-checkout/OxygenCheckoutScreen';
import { useOxygenColors } from '@/components/oxygen-checkout/OxygenFormPrimitives';
import { OxygenAction } from '@/components/oxygen-checkout/oxygen-presentation';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';

export default function OxygenCheckoutRoute() {
  const colors = useOxygenColors();
  const { orderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const parsed = z
    .uuid()
    .safeParse(
      Array.isArray(orderId) && orderId.length === 1 ? orderId[0] : orderId
    );
  return (
    <StorefrontScreenShell
      edges={parsed.success ? [] : ['left', 'right', 'bottom']}
      themeBackground
    >
      {parsed.success ? (
        <OxygenCheckoutScreen orderId={parsed.data} />
      ) : (
        <View style={{ gap: 16, padding: 20 }}>
          <Text style={{ color: colors.text }}>
            {orderId
              ? 'This Oxygen checkout link is invalid.'
              : 'Open a saved Oxygen order from your order history.'}
          </Text>
          <OxygenAction
            label="View my orders"
            onPress={() => router.replace('/orders')}
          />
        </View>
      )}
    </StorefrontScreenShell>
  );
}
