import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import {
  mockAdSlotModule,
  mockAuthGuardModule,
  mockCartRepriceModule,
  mockCartStoreModule,
  mockCheckoutEntryPrefetchModule,
  mockCheckoutIdentityModule,
  mockColorSchemeModule,
  mockExpoRouterModule,
  mockHapticsModule,
  mockReactQueryModule,
  mockReanimatedModule,
  mockSafeAreaModule,
  mockSafeImageModule,
  mockShallowModule,
  mockUIStoreModule,
  mockUseColorScheme,
  setupCartMocks,
} from './cart.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@tanstack/react-query', () => mockReactQueryModule());
jest.mock('@/components/checkout/checkout-entry-prefetch', () =>
  mockCheckoutEntryPrefetchModule()
);
jest.mock('@/components/cart/use-cart-reprice', () => mockCartRepriceModule());
jest.mock('@/components/ads/AdSlot', () => mockAdSlotModule());
jest.mock('expo-haptics', () => mockHapticsModule());
jest.mock('zustand/react/shallow', () => mockShallowModule());
jest.mock('react-native-reanimated', () => mockReanimatedModule());
jest.mock('@/components/useColorScheme', () => mockColorSchemeModule());
jest.mock('@/components/checkout/checkout-identity', () =>
  mockCheckoutIdentityModule()
);
jest.mock('@/components/ui/SafeImage', () => mockSafeImageModule());
jest.mock('@/stores/cart-store', () => mockCartStoreModule());
jest.mock('@/hooks/use-auth-guard', () => mockAuthGuardModule());
jest.mock('react-native-safe-area-context', () => mockSafeAreaModule());
jest.mock('@/stores/ui-store', () => mockUIStoreModule());

import CartScreen from '@/app/cart';

describe('CartScreen theming', () => {
  beforeEach(() => {
    setupCartMocks();
  });

  it('renders readable dark mode cart content', () => {
    render(<CartScreen />);

    expect(
      StyleSheet.flatten(
        screen.getByText('Lenovo ThinkPad E16 Gen 2').props.style
      )
    ).toMatchObject({ color: Colors.dark.text });
    expect(
      StyleSheet.flatten(
        screen.getByText('Device Protection (+5%)').props.style
      )
    ).toMatchObject({ color: Colors.dark.textSecondary });
    expect(
      StyleSheet.flatten(screen.getByText('Secure Checkout').props.style)
    ).toMatchObject({ color: Colors.dark.textSecondary });
  });

  // These assertions intentionally pin design-system token usage so the cart
  // stays readable in each theme. Update them only if the accessibility contract

  it('keeps light mode readable too', () => {
    mockUseColorScheme.mockReturnValue('light');

    render(<CartScreen />);

    expect(
      StyleSheet.flatten(
        screen.getByText('Lenovo ThinkPad E16 Gen 2').props.style
      )
    ).toMatchObject({ color: Colors.light.text });
    expect(
      StyleSheet.flatten(
        screen.getByText('Device Protection (+5%)').props.style
      )
    ).toMatchObject({ color: Colors.light.textSecondary });
    expect(
      StyleSheet.flatten(screen.getByText('Secure Checkout').props.style)
    ).toMatchObject({ color: Colors.light.textSecondary });
  });
});
