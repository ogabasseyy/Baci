import Ionicons from '@react-native-vector-icons/ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AdminFloatingTabBar } from '@/components/navigation/AdminFloatingTabBar';
import { useFailedOrders } from '@/hooks/useFailedOrders';
import { useTheme } from '@/hooks/useTheme';

export const unstable_settings = { initialRouteName: 'index' };

export default function TabLayout() {
  if (__DEV__) {
    console.log('[TabLayout] Rendering Debug View');
  }
  const { colors } = useTheme();
  const { data: failedOrders } = useFailedOrders();
  const failedCount = failedOrders?.length ?? 0;

  return (
    <View
      testID="tab-shell"
      style={[styles.shell, { backgroundColor: colors.card }]}
    >
      <Tabs
        detachInactiveScreens={false}
        tabBar={(props) => <AdminFloatingTabBar {...props} />}
        screenOptions={{
          freezeOnBlur: false,
          headerShown: false,
          lazy: true,
          tabBarActiveTintColor: colors.primary,
          tabBarHideOnKeyboard: true,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarShowLabel: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                color={color}
                name={focused ? 'home' : 'home-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: 'Orders',
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                color={color}
                name={focused ? 'receipt' : 'receipt-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="products"
          options={{
            title: 'Products',
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                color={color}
                name={focused ? 'cube' : 'cube-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="customers"
          options={{
            title: 'Customers',
            // Follow-up checkout drop-offs belong with customer outreach, not Orders.
            tabBarBadge: failedCount > 0 ? failedCount : undefined,
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                color={color}
                name={focused ? 'people' : 'people-outline'}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: 'Menu',
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                color={color}
                name={focused ? 'menu' : 'menu-outline'}
                size={size}
              />
            ),
          }}
        />

        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
});
