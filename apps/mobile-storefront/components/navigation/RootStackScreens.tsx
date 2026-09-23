import { Stack } from 'expo-router';
import type { ReactElement } from 'react';

interface RootStackScreensProps {
  // Content background colour for screens that override the default shell
  // colour (currently just the utilities stack).
  mutedContentBackgroundColor: string;
}

/**
 * Each Stack.Screen element is rendered into the Stack at runtime. The
 * explicit return type makes the contract obvious and lets TypeScript
 * catch a future change that wraps these in a Fragment or component
 * (which would re-trigger the original Symbol/Stack.Screen-recognition
 * regressions documented below).
 */
type RootStackScreenList = ReactElement[];

/**
 * Full `<Stack.Screen>` manifest for the storefront root stack. Extracted
 * from `RootLayoutNav.tsx` so that file stays under the 300-line limit
 * required by `CLAUDE.md`.
 *
 * NOTE: This is intentionally NOT a React component. Expo Router's `<Stack>`
 * inspects its direct children for `Stack.Screen` and does not recurse into
 * wrapper components (logs "Unknown child element passed to Stack"). It
 * also does not unwrap React.Fragment children — `mapProtectedScreen`
 * iterates with the fragment's Symbol type still in play, throwing
 * "Cannot convert Symbol to string". Returning a plain array of keyed
 * `<Stack.Screen>` elements lets React flatten them into Stack's children
 * cleanly.
 *
 * Call site: `<Stack>{renderRootStackScreens({ ... })}</Stack>`.
 */
export function renderRootStackScreens({
  mutedContentBackgroundColor,
}: RootStackScreensProps): RootStackScreenList {
  return [
    <Stack.Screen
      key="(tabs)"
      name="(tabs)"
      options={{
        headerShown: false,
        headerBackTitle: '',
        title: '',
      }}
    />,
    <Stack.Screen
      key="product/[slug]"
      name="product/[slug]"
      options={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="checkout"
      name="checkout"
      options={{
        title: 'Checkout',
        // Must be disabled at registration: the screen draws its own header.
        // Toggling it later from an inline <Stack.Screen> mounted the first
        // frames with the native header reserving space, then the content
        // jumped up once the override applied (iOS "opens low, adjusts up").
        headerShown: false,
        presentation: 'card',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="quiz/prize-checkout-simulation"
      name="quiz/prize-checkout-simulation"
      options={{
        headerShown: false,
        presentation: 'card',
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    />,
    <Stack.Screen
      key="cart"
      name="cart"
      options={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
      }}
    />,
    <Stack.Screen
      key="order-success"
      name="order-success"
      options={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'fade',
      }}
    />,
    <Stack.Screen
      key="search"
      name="search"
      options={{
        headerShown: false,
        animation: 'fade',
      }}
    />,
    <Stack.Screen
      key="auth/login"
      name="auth/login"
      options={{
        title: '',
        presentation: 'modal',
        animation: 'slide_from_bottom',
      }}
    />,
    <Stack.Screen
      key="orders/index"
      name="orders/index"
      options={{
        title: 'My Orders',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="orders/[id]"
      name="orders/[id]"
      options={{
        title: 'Order Details',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="receipts/index"
      name="receipts/index"
      options={{
        title: 'Receipts & Invoices',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="addresses/index"
      name="addresses/index"
      options={{
        title: 'My Addresses',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="addresses/[id]"
      name="addresses/[id]"
      options={({ route }) => ({
        title:
          (route.params as { id?: string })?.id === 'new'
            ? 'Add Address'
            : 'Edit Address',
      })}
    />,
    <Stack.Screen
      key="settings/index"
      name="settings/index"
      options={{
        title: 'App Settings',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="notifications"
      name="notifications"
      options={{
        title: 'Notifications',
      }}
    />,
    <Stack.Screen
      key="category/[slug]"
      name="category/[slug]"
      options={{
        title: 'Category',
      }}
    />,
    <Stack.Screen
      key="wallet/index"
      name="wallet/index"
      options={{
        title: 'Wallet & Rewards',
      }}
    />,
    <Stack.Screen
      key="wallet/manage-cards"
      name="wallet/manage-cards"
      options={{
        title: 'Manage Cards',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="wallet/savings/start"
      name="wallet/savings/start"
      options={{
        title: 'Start Savings',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="utilities"
      name="utilities"
      options={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: {
          backgroundColor: mutedContentBackgroundColor,
        },
      }}
    />,
    <Stack.Screen
      key="swap/index"
      name="swap/index"
      options={{
        title: 'Swap & Trade-in',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="imei-check/index"
      name="imei-check/index"
      options={{
        title: 'IMEI Checker',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="repairs/index"
      name="repairs/index"
      options={{
        title: 'Repair Lab',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="saved/index"
      name="saved/index"
      options={{
        title: 'Saved Items',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="compare/index"
      name="compare/index"
      options={{
        title: 'Compare Products',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="bnpl-checkout/index"
      name="bnpl-checkout/index"
      options={{
        title: 'Buy Now Pay Later',
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    />,
    <Stack.Screen
      key="crypto-payment/index"
      name="crypto-payment/index"
      options={{
        title: 'Crypto Payment',
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}
    />,
    <Stack.Screen
      key="profile/edit"
      name="profile/edit"
      options={{
        title: 'Edit Profile',
        animation: 'slide_from_right',
      }}
    />,
    <Stack.Screen
      key="faq/index"
      name="faq/index"
      options={{
        title: 'Help & Support',
        animation: 'slide_from_right',
      }}
    />,
  ];
}
