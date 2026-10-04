import { Redirect, Stack } from 'expo-router';
import { SavingsNotificationsScreen } from '@/components/notifications/SavingsNotificationsScreen';
import { StorefrontScreenShell } from '@/components/storefront/StorefrontScreenShell';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';

export default function NotificationsScreen() {
  const merchantId = useAuthStore((state) => state.merchantId);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const { redirectTo } = useRequireAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  if (redirectTo) {
    return <Redirect href={redirectTo} />;
  }

  return (
    <StorefrontScreenShell
      edges={['bottom']}
      style={{ backgroundColor: colors.background, flex: 1 }}
    >
      <Stack.Screen options={{ title: 'Savings notifications' }} />
      <SavingsNotificationsScreen
        merchantId={pickMerchantId(merchantId, CONFIG.MERCHANT_ID)}
        userId={userId}
      />
    </StorefrontScreenShell>
  );
}
