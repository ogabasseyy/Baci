import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';
import {
  mockAdSlotModule,
  mockAuthGuardModule,
  mockCartRepriceModule,
  mockCartStoreModule,
  mockCheckoutEntryPrefetchModule,
  mockCheckoutIdentityModule,
  mockColorSchemeModule,
  mockDismissPriceChanges,
  mockExpoRouterModule,
  mockHapticsModule,
  mockReactQueryModule,
  mockReanimatedModule,
  mockRepriceHolder,
  mockSafeAreaModule,
  mockSafeImageModule,
  mockShallowModule,
  mockUIStoreModule,
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

describe('CartScreen price-change modal', () => {
  beforeEach(() => {
    setupCartMocks('light');
  });

  it('surfaces the price-change modal when reprice reports a drift', () => {
    mockRepriceHolder.current = {
      priceChanges: [
        {
          id: 'cart-1',
          name: 'Lenovo ThinkPad E16 Gen 2',
          oldPrice: 1428000,
          newPrice: 1500000,
        },
      ],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    render(<CartScreen />);

    expect(screen.getByText('Prices updated')).toBeTruthy();
    expect(screen.getByLabelText('Continue with updated prices')).toBeTruthy();
  });

  it('dismisses the price-change modal when the shopper continues', () => {
    mockRepriceHolder.current = {
      priceChanges: [
        {
          id: 'cart-1',
          name: 'Lenovo ThinkPad E16 Gen 2',
          oldPrice: 1428000,
          newPrice: 1500000,
        },
      ],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    render(<CartScreen />);
    fireEvent.press(screen.getByLabelText('Continue with updated prices'));

    expect(mockDismissPriceChanges).toHaveBeenCalledTimes(1);
  });

  it('withholds the cart ad until the price-change dismissal completes', () => {
    // Regression: dismissPriceChanges empties priceChanges synchronously
    // while the iOS fade dismissal still covers the screen — CART_MPU must
    // stay unmounted until onDismiss fires.
    mockRepriceHolder.current = {
      priceChanges: [
        {
          id: 'cart-1',
          name: 'Lenovo ThinkPad E16 Gen 2',
          oldPrice: 1428000,
          newPrice: 1500000,
        },
      ],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    const { UNSAFE_getAllByType, rerender } = render(<CartScreen />);
    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();

    mockRepriceHolder.current = {
      priceChanges: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };
    rerender(<CartScreen />);
    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();

    // CartScreen renders CartLoadedView (owning the negotiation modal) before
    // the price-change modal, so the price modal is the last dismissable one.
    const priceChangeModal = UNSAFE_getAllByType(Modal)
      .filter((modal) => typeof modal.props.onDismiss === 'function')
      .at(-1);
    act(() => {
      priceChangeModal?.props.onDismiss();
    });
    expect(screen.getByTestId('ad-slot-CART_MPU')).toBeTruthy();
  });
});
