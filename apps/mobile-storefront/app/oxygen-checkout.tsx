import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { z } from 'zod';
import { OxygenCheckoutScreen } from '@/components/oxygen-checkout/OxygenCheckoutScreen';
export default function OxygenCheckoutRoute() {
  const { orderId } = useLocalSearchParams<{ orderId?: string | string[] }>();
  const parsed = z.uuid().safeParse(orderId);
  return parsed.success ? (
    <OxygenCheckoutScreen orderId={parsed.data} />
  ) : (
    <Text>Open a saved Oxygen order from your order history.</Text>
  );
}
