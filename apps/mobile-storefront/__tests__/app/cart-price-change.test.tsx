import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, Platform } from 'react-native';
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

let mockSetCheckoutIdentityOpen: ((open: boolean) => void) | null = null;

// These isolated screen fixtures represent a focused navigation route.
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => true }));

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
jest.mock(
  '@/components/checkout/checkout-identity/useCheckoutIdentityOverlay',
  () => {
    const { useState } = jest.requireActual<typeof import('react')>('react');
    return {
      useCheckoutIdentityOverlay: () => {
        const [isOpen, setIsOpen] = useState(false);
        mockSetCheckoutIdentityOpen = setIsOpen;
        return {
          isOpen,
          open: () => setIsOpen(true),
          close: () => setIsOpen(false),
        };
      },
    };
  }
);
jest.mock('@/components/ui/SafeImage', () => mockSafeImageModule());
jest.mock('@/stores/cart-store', () => mockCartStoreModule());
jest.mock('@/hooks/useMerchantPaymentSettings', () => ({
  merchantPaymentSettingsQueryKey: ['test-payment-settings'],
  useMerchantPaymentSettings: () => ({
    data: { shipping_insurance_enabled: true },
  }),
}));
jest.mock('@/hooks/use-warm-merchant-payment-settings', () => ({
  useWarmMerchantPaymentSettings: jest.fn(),
}));
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
      conditionChanges: [],
      unavailableLines: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    render(<CartScreen />);

    expect(screen.getByText('Prices updated')).toBeTruthy();
    expect(screen.getByLabelText('Continue with updated prices')).toBeTruthy();
  });

  it('defers native cart repricing while the identity overlay is open on Android', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    mockRepriceHolder.current = {
      priceChanges: [
        {
          id: 'cart-1',
          name: 'Lenovo ThinkPad E16 Gen 2',
          oldPrice: 1428000,
          newPrice: 1500000,
        },
      ],
      conditionChanges: [],
      unavailableLines: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    const { UNSAFE_getAllByType } = render(<CartScreen />);
    const getPriceChangeModal = () =>
      UNSAFE_getAllByType(Modal)
        .filter((modal) => typeof modal.props.onDismiss === 'function')
        .at(-1);
    expect(getPriceChangeModal()?.props.visible).toBe(true);

    act(() => mockSetCheckoutIdentityOpen?.(true));
    expect(getPriceChangeModal()?.props.visible).toBe(false);

    act(() => mockSetCheckoutIdentityOpen?.(false));
    expect(getPriceChangeModal()?.props.visible).toBe(true);
    jest.restoreAllMocks();
  });

  it('keeps the cart ad gated until a deferred iOS repricing modal is reviewed', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockRepriceHolder.current = {
      priceChanges: [
        {
          id: 'cart-1',
          name: 'Lenovo ThinkPad E16 Gen 2',
          oldPrice: 1428000,
          newPrice: 1500000,
        },
      ],
      conditionChanges: [],
      unavailableLines: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    const { rerender, UNSAFE_getAllByType } = render(<CartScreen />);
    act(() => mockSetCheckoutIdentityOpen?.(true));
    const modalWhileDeferred = UNSAFE_getAllByType(Modal)
      .filter((item) => typeof item.props.onDismiss === 'function')
      .at(-1);
    act(() => modalWhileDeferred?.props.onDismiss());

    act(() => mockSetCheckoutIdentityOpen?.(false));
    fireEvent.press(screen.getByLabelText('Continue with updated prices'));
    mockRepriceHolder.current = {
      priceChanges: [],
      conditionChanges: [],
      unavailableLines: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };
    rerender(<CartScreen />);

    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();
    const dismissedModal = UNSAFE_getAllByType(Modal)
      .filter((item) => typeof item.props.onDismiss === 'function')
      .at(-1);
    act(() => dismissedModal?.props.onDismiss());
    expect(screen.getByTestId('ad-slot-CART_MPU')).toBeTruthy();
    jest.restoreAllMocks();
  });

  it('surfaces unavailable lines in the cart without price drift', () => {
    mockRepriceHolder.current = {
      priceChanges: [],
      conditionChanges: [],
      unavailableLines: [{ id: 'cart-9', name: 'Vanished Phone' }],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    render(<CartScreen />);

    expect(screen.getByText('Items unavailable')).toBeTruthy();
    expect(screen.getByText('Vanished Phone')).toBeTruthy();
    expect(
      screen.getByLabelText('Continue after reviewing unavailable items')
    ).toBeTruthy();
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
      conditionChanges: [],
      unavailableLines: [],
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
      conditionChanges: [],
      unavailableLines: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };

    const { UNSAFE_getAllByType, rerender } = render(<CartScreen />);
    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();

    mockRepriceHolder.current = {
      priceChanges: [],
      conditionChanges: [],
      unavailableLines: [],
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
