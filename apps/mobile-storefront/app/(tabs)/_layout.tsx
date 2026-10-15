import { router, Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useShallow } from 'zustand/react/shallow';
import { ErrorFallback } from '@/components/ErrorBoundary';
import { CustomTabBar } from '@/components/navigation/CustomTabBar';
import {
  TabBarIcon,
  TabBarLabel,
} from '@/components/navigation/TabBarComponents';
import { useWarmMerchantPaymentSettings } from '@/hooks/use-warm-merchant-payment-settings';
import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/stores/auth-store';
import { useCartStore } from '@/stores/cart-store';
import { useSavedStore } from '@/stores/saved-store';

export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return <ErrorFallback error={error} retry={retry} />;
}

export default function TabLayout() {
  const { colors } = useTheme();
  // Warm the payment-settings cache at storefront launch so quick-adds
  // resolve the live shipping-insurance toggle instead of unknown, and
  // reconcile lines that were added while it was still loading.
  useWarmMerchantPaymentSettings();

  const cartCount = useCartStore((state) => state.itemCount());
  const savedCount = useSavedStore((state) => state.items.length);
  const { user, isInitialized } = useAuthStore(
    useShallow((state) => ({
      user: state.user,
      isInitialized: state.isInitialized,
    }))
  );

  const activeTint = colors.text;
  const inactiveTint = colors.mutedForeground;
  const shouldPreloadProtectedTabs = isInitialized && Boolean(user);

  /**
   * 2026 Best Practice: Layout-level auth gating for tabs.
   * Intercept tab presses BEFORE the tab screen mounts.
   * Uses router.push (not replace) so login is stacked ON TOP → back works.
   */
  const createAuthListener = (tabPath: string) => ({
    tabPress: (e: { preventDefault: () => void }) => {
      if (isInitialized && !user) {
        e.preventDefault();
        const returnTo = encodeURIComponent(`/(tabs)/${tabPath}`);
        router.push(`/auth/login?returnTo=${returnTo}`);
      }
    },
  });

  return (
    <Tabs
      initialRouteName="index"
      detachInactiveScreens={true}
      tabBar={(props) => (
        <CustomTabBar
          {...(props as unknown as BottomTabBarProps)}
          preloadProtectedTabs={shouldPreloadProtectedTabs}
        />
      )}
      screenOptions={{
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        headerShown: false,
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTitleStyle: {
          fontFamily: 'Inter_600SemiBold',
          fontSize: 17,
        },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        lazy: true,
        freezeOnBlur: true,
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: true, // Needed for our custom label component
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerShown: false,
          freezeOnBlur: true,
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              name={focused ? 'home' : 'home-outline'}
              focused={focused}
            />
          ),
          tabBarLabel: ({ focused }) => (
            <TabBarLabel focused={focused} label="Home" />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              name={focused ? 'heart' : 'heart-outline'}
              focused={focused}
              badge={savedCount}
            />
          ),
          tabBarLabel: ({ focused }) => (
            <TabBarLabel focused={focused} label="Saved" />
          ),
        }}
      />
      <Tabs.Screen
        name="cart-tab"
        options={{
          title: 'Cart',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              name={focused ? 'cart' : 'cart-outline'}
              focused={focused}
              badge={cartCount}
            />
          ),
          tabBarLabel: ({ focused }) => (
            <TabBarLabel focused={focused} label="Cart" />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              name={focused ? 'wallet' : 'wallet-outline'}
              focused={focused}
            />
          ),
          tabBarLabel: ({ focused }) => (
            <TabBarLabel focused={focused} label="Wallet" />
          ),
        }}
        listeners={createAuthListener('wallet')}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              name={focused ? 'person' : 'person-outline'}
              focused={focused}
            />
          ),
          tabBarLabel: ({ focused }) => (
            <TabBarLabel focused={focused} label="Account" />
          ),
        }}
        listeners={createAuthListener('account')}
      />
      {/* Categories hidden from tab bar but reachable via route */}
      <Tabs.Screen
        name="categories"
        options={{
          href: null,
          title: 'Explore',
        }}
      />
    </Tabs>
  );
}
