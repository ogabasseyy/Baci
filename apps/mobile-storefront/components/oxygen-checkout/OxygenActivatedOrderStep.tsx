import { router } from 'expo-router';
import { OrderSuccessView } from '@/components/orders/OrderSuccessView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export function OxygenActivatedOrderStep({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber?: string;
}) {
  const scheme = useColorScheme();
  return (
    <OrderSuccessView
      colors={Colors[scheme ?? 'light']}
      isDark={scheme === 'dark'}
      oxygenPlanConfirmed
      orderNumber={orderNumber}
      showPermissionModal={false}
      onPermissionDeny={() => undefined}
      onPermissionGrant={() => undefined}
      onContinueShopping={() => router.replace('/')}
      onViewOrders={() =>
        router.push({ pathname: '/orders/[id]', params: { id: orderId } })
      }
    />
  );
}
