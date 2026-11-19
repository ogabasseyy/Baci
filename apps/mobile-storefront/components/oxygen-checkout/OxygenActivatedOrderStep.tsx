import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { OxygenActionFooter } from './OxygenActionFooter';
import { useOxygenColors } from './OxygenFormPrimitives';
import { OxygenStatusCard } from './OxygenStatusCard';
import { OxygenAction } from './oxygen-presentation';

export function OxygenActivatedOrderStep({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber?: string;
}) {
  const colors = useOxygenColors();
  return (
    <View style={{ gap: 20 }}>
      <OxygenStatusCard
        icon="checkmark-circle-outline"
        eyebrow="OXYGEN FINANCE"
        title="Your payment plan is active"
        description="Oxygen confirmed your upfront payment and repayment setup. Your order is waiting for the merchant’s payment confirmation."
      />
      {orderNumber ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.textSecondary }}>Order number</Text>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {orderNumber}
          </Text>
        </View>
      ) : null}
      <OxygenActionFooter>
        <OxygenAction
          label="View order"
          onPress={() =>
            router.push({ pathname: '/orders/[id]', params: { id: orderId } })
          }
        />
      </OxygenActionFooter>
    </View>
  );
}
