import { Redirect, Stack } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAdminAnalyticsSync } from '@/hooks/useAdminAnalyticsSync';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useTheme } from '@/hooks/useTheme';

export default function AdminLayout() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const {
    registerPush,
    isRegistered,
    isLoading: isPushLoading,
  } = usePushNotifications();
  const { colors } = useTheme();
  const { merchant } = useMerchant();
  useAdminAnalyticsSync(user, merchant);
  // Track which merchantId we've attempted registration for to prevent retry
  // loops when registration fails — only attempt once per merchant session.
  const attemptedMerchantIdRef = useRef<string | null>(null);

  // Auto-register for push notifications when authenticated and merchant is loaded.
  // isPushLoading guards concurrent calls; attemptedMerchantIdRef prevents retries on failure.
  useEffect(() => {
    if (
      isAuthenticated &&
      !isRegistered &&
      !isPushLoading &&
      merchant?.id &&
      user?.id &&
      attemptedMerchantIdRef.current !== merchant.id
    ) {
      attemptedMerchantIdRef.current = merchant.id;
      void registerPush(merchant.id).catch((error) => {
        console.error('[Push] Failed to trigger registration:', error);
      });
    }
  }, [
    isAuthenticated,
    isRegistered,
    isPushLoading,
    registerPush,
    merchant?.id,
    user?.id,
  ]);

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <ErrorBoundary>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerBackTitle: 'Back',
        }}
      >
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
            title: 'Dashboard',
            contentStyle: {
              backgroundColor: colors.background,
              marginTop: 0,
              marginBottom: 0,
            },
          }}
        />
        <Stack.Screen
          name="order/[id]"
          options={{ title: 'Order Details', presentation: 'card' }}
        />
        <Stack.Screen
          name="order/new"
          options={{ title: 'New Order', presentation: 'card' }}
        />
        <Stack.Screen
          name="product/[id]"
          options={{ title: 'Edit Product', presentation: 'card' }}
        />
        <Stack.Screen
          name="scan"
          options={{ title: 'Scan Barcode', presentation: 'modal' }}
        />
        <Stack.Screen
          name="domains"
          options={{ headerShown: false, presentation: 'card' }}
        />

        {/* Sub-screens with headers enabled */}
        <Stack.Screen name="analytics/index" options={{ title: 'Analytics' }} />
        <Stack.Screen name="blog/index" options={{ title: 'Blog' }} />
        <Stack.Screen
          name="blog/preview"
          options={{ title: 'Blog Preview', presentation: 'card' }}
        />
        <Stack.Screen
          name="customer/[id]"
          options={{ title: 'Customer Details' }}
        />
        <Stack.Screen
          name="customer/edit/[id]"
          options={{ title: 'Edit Customer', presentation: 'card' }}
        />
        <Stack.Screen name="discounts/index" options={{ title: 'Discounts' }} />
        <Stack.Screen name="expenses/index" options={{ title: 'Expenses' }} />

        {/* Individual screens */}
        <Stack.Screen
          name="contact-support"
          options={{ title: 'Contact Support' }}
        />
        <Stack.Screen name="customize" options={{ title: 'Customize Store' }} />

        <Stack.Screen name="help" options={{ title: 'Help & Support' }} />
        <Stack.Screen name="kyc" options={{ title: 'Identity Verification' }} />
        <Stack.Screen
          name="notifications"
          options={{ title: 'Notifications' }}
        />
        <Stack.Screen
          name="payment-methods"
          options={{ title: 'Payment Methods' }}
        />
        <Stack.Screen
          name="payout-settings"
          options={{ title: 'Payout Settings' }}
        />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen
          name="send-feedback"
          options={{ title: 'Send Feedback' }}
        />
        <Stack.Screen
          name="setup-checklist"
          options={{ title: 'Setup Checklist' }}
        />
        <Stack.Screen
          name="shipping"
          options={{ title: 'Shipping Settings' }}
        />
        <Stack.Screen name="staff" options={{ title: 'Staff Management' }} />
        <Stack.Screen
          name="staff-accounts"
          options={{ title: 'Payment Accounts' }}
        />
        <Stack.Screen name="negotiations" options={{ title: 'Negotiations' }} />
        <Stack.Screen name="messages/index" options={{ title: 'Messages' }} />
        <Stack.Screen
          name="messages/[id]"
          options={{ title: 'Conversation', presentation: 'card' }}
        />
        <Stack.Screen
          name="repairs/index"
          options={{ title: 'Repair Bookings' }}
        />
        <Stack.Screen
          name="repairs/[id]"
          options={{ title: 'Booking Details', presentation: 'card' }}
        />
        <Stack.Screen
          name="store-settings"
          options={{ title: 'Store Settings' }}
        />
        <Stack.Screen name="tax" options={{ title: 'Tax Settings' }} />
        <Stack.Screen
          name="transaction-reconciliation"
          options={{ title: 'Match Transaction Items' }}
        />
        <Stack.Screen
          name="analytics-config"
          options={{ title: 'Analytics & Tracking' }}
        />
        <Stack.Screen
          name="sales-channels"
          options={{ title: 'Marketplaces' }}
        />
        <Stack.Screen name="social-media" options={{ title: 'Social Media' }} />
        <Stack.Screen name="subscribe" options={{ title: 'Subscribe' }} />
      </Stack>
    </ErrorBoundary>
  );
}
