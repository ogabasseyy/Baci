import { Redirect, router, Stack } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
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
  const { isLoading: authLoading, redirectTo } = useRequireAuth();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  if (redirectTo) {
    return <Redirect href={redirectTo} />;
  }
  // Wait for auth hydration before resolving the merchant scope: mounting
  // the inbox on the configured fallback while the auth merchant is still
  // null would fire a transient wrong-merchant fetch (server 404s it, but
  // the error flashes). The fallback still applies after hydration for
  // genuinely merchant-less contexts.
  if (authLoading) {
    return <ActivityIndicator accessibilityLabel="Loading notifications" />;
  }

  // This route intentionally hosts the savings inbox: the previous screen
  // rendered a hardcoded empty placeholder with no data source, and
  // order/promo pushes deep-link straight to their content screens (see
  // getStorefrontNotificationNavigationTarget) rather than to this route. The
  // footer preserves order reachability from the notifications surface.
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
      <Pressable
        accessibilityLabel="View your orders"
        accessibilityRole="button"
        onPress={() => router.push('/orders')}
        style={styles.ordersLink}
      >
        <Text style={[styles.ordersLinkText, { color: colors.primary }]}>
          Looking for order updates? View your orders
        </Text>
      </Pressable>
    </StorefrontScreenShell>
  );
}

const styles = StyleSheet.create({
  ordersLink: { alignItems: 'center', padding: 16 },
  ordersLinkText: { fontSize: 14, fontWeight: '600' },
});
