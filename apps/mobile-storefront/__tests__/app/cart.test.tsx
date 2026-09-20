import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, StyleSheet } from 'react-native';
import CartScreen from '@/app/cart';
import Colors from '@/constants/Colors';

type MockAuthStatus = {
  customer: null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  user: { id: string } | null;
};

const mockOpenNegotiation = jest.fn();
const mockUseColorScheme = jest.fn(() => 'dark');
const mockQueryClient = { prefetchQuery: jest.fn() };
const mockWarmCheckoutEntry = jest.fn();
const mockDismissPriceChanges = jest.fn();
type MockPriceChange = {
  id: string;
  name: string;
  oldPrice: number;
  newPrice: number;
};
let mockRepriceResult: {
  priceChanges: MockPriceChange[];
  dismissPriceChanges: typeof mockDismissPriceChanges;
} = {
  priceChanges: [],
  dismissPriceChanges: mockDismissPriceChanges,
};
const mockRouterPrefetch = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterCanGoBack = jest.fn(() => false);
const buildAuthStatus = (
  overrides: Partial<MockAuthStatus> = {}
): MockAuthStatus => ({
  customer: null,
  isAuthenticated: false,
  isGuest: true,
  isInitialized: true,
  isLoading: false,
  user: null,
  ...overrides,
});
const mockUseAuthStatus = jest.fn((): MockAuthStatus => buildAuthStatus());

jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    canGoBack: () => mockRouterCanGoBack(),
    prefetch: (...args: unknown[]) => mockRouterPrefetch(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
  useIsFocused: () => true,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}));

jest.mock('@/components/checkout/checkout-entry-prefetch', () => ({
  warmCheckoutEntry: (...args: unknown[]) => mockWarmCheckoutEntry(...args),
}));

jest.mock('@/components/cart/use-cart-reprice', () => ({
  useCartReprice: () => mockRepriceResult,
}));

jest.mock('@/components/ads/AdSlot', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
});

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: T) => selector,
}));

jest.mock('react-native-reanimated', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');

  const makeSharedValue = (value: number) => {
    let current = value;
    return {
      get: () => current,
      set: (next: number) => {
        current = next;
      },
    };
  };

  return {
    __esModule: true,
    default: { View },
    View,
    cancelAnimation: jest.fn(),
    useAnimatedStyle: (updater: () => object) => updater(),
    useSharedValue: makeSharedValue,
    withRepeat: (value: number) => value,
    withSequence: (...values: number[]) => values.at(-1) ?? 0,
    withTiming: (value: number) => value,
  };
});

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('@/components/checkout/checkout-identity', () => {
  const { Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    CheckoutIdentityModal: ({ isOpen }: { isOpen: boolean }) => {
      if (!isOpen) return null;
      return <MockText>Checkout Identity Modal</MockText>;
    },
  };
});

jest.mock('@/components/ui/SafeImage', () => ({
  SafeImage: function MockSafeImage() {
    return null;
  },
}));

const createMockCartState = (overrides: Record<string, unknown> = {}) => ({
  items: [
    {
      id: 'cart-1',
      product_id: 'product-1',
      slug: 'lenovo-thinkpad-e16-gen-2',
      name: 'Lenovo ThinkPad E16 Gen 2',
      price: 1428000,
      quantity: 1,
      image_url: 'https://example.com/lenovo.jpg',
      condition: 'NEW',
      hasAssurance: false,
      assuranceRate: 0.05,
    },
  ],
  itemCount: () => 1,
  subtotal: () => 1428000,
  updateQuantity: jest.fn(),
  removeItem: jest.fn(),
  clearCart: jest.fn(),
  toggleAssurance: jest.fn(),
  ...overrides,
});

let mockCartState: Record<string, unknown> = createMockCartState();

jest.mock('@/stores/cart-store', () => ({
  formatPrice: (value: number) =>
    `₦${new Intl.NumberFormat('en-NG').format(value)}`,
  useCartStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mockCartState),
}));

jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthStatus: () => mockUseAuthStatus(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({
    top: 16,
    right: 0,
    bottom: 0,
    left: 0,
  }),
}));

jest.mock('@/stores/ui-store', () => ({
  useUIStore: (
    selector: (state: {
      openNegotiation: typeof mockOpenNegotiation;
    }) => unknown
  ) => selector({ openNegotiation: mockOpenNegotiation }),
}));

describe('CartScreen theming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseColorScheme.mockReturnValue('dark');
    mockUseAuthStatus.mockReturnValue(buildAuthStatus());
    mockRouterCanGoBack.mockReturnValue(false);
    mockCartState = createMockCartState();
  });

  // These assertions intentionally pin design-system token usage so the cart
  // stays readable in each theme. Update them only if the accessibility contract
  // or theme tokens change.
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
  // or theme tokens change.
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

describe('CartScreen state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseColorScheme.mockReturnValue('dark');
    mockUseAuthStatus.mockReturnValue(buildAuthStatus());
    mockRouterCanGoBack.mockReturnValue(false);
    mockCartState = createMockCartState();
  });

  it('renders empty cart state when there are no cart items', () => {
    mockCartState = createMockCartState({
      items: [],
      itemCount: () => 0,
      subtotal: () => 0,
    });

    render(<CartScreen />);

    expect(screen.getByText('Your cart is empty 🛒')).toBeTruthy();
    expect(screen.getByText('Start Shopping')).toBeTruthy();
    expect(screen.queryByText('Lenovo ThinkPad E16 Gen 2')).toBeNull();
  });

  it('renders cart error state when cart data is unavailable', () => {
    mockCartState = {
      items: undefined,
      itemCount: undefined,
      subtotal: undefined,
      updateQuantity: undefined,
      removeItem: undefined,
      clearCart: undefined,
      toggleAssurance: undefined,
    };

    render(<CartScreen />);

    expect(screen.getByText('Unable to load cart')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
    expect(screen.queryByText('Lenovo ThinkPad E16 Gen 2')).toBeNull();
  });

  it('opens guest identity modal for guests and routes signed-in users straight to checkout', () => {
    const { rerender } = render(<CartScreen />);

    fireEvent.press(
      screen.getByRole('button', { name: /Proceed to checkout, total/i })
    );

    expect(screen.getByText('Checkout Identity Modal')).toBeTruthy();
    expect(mockRouterPush).not.toHaveBeenCalled();

    mockUseAuthStatus.mockReturnValue(
      buildAuthStatus({
        isAuthenticated: true,
        isGuest: false,
        user: { id: 'user-1' },
      })
    );

    rerender(<CartScreen />);
    jest.clearAllMocks();
    const checkoutButton = screen.getByRole('button', {
      name: /Proceed to checkout, total/i,
    });
    fireEvent(checkoutButton, 'pressIn');
    fireEvent.press(checkoutButton);

    expect(mockRouterPrefetch).toHaveBeenCalledWith('/checkout');
    expect(mockWarmCheckoutEntry).toHaveBeenCalledWith(mockQueryClient);
    expect(mockRouterPush).toHaveBeenCalledWith('/checkout');
  });

  it('does not warm checkout data while a populated cart is open', () => {
    render(<CartScreen />);

    expect(mockRouterPrefetch).not.toHaveBeenCalled();
    expect(mockWarmCheckoutEntry).not.toHaveBeenCalled();
  });

  it('falls back to home replacement when the cart header has no back stack', () => {
    render(<CartScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Back to home' }));

    expect(mockRouterCanGoBack).toHaveBeenCalledTimes(1);
    expect(mockRouterBack).not.toHaveBeenCalled();
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('preserves deep navigation history when the cart header can go back', () => {
    mockRouterCanGoBack.mockReturnValue(true);

    render(<CartScreen />);

    fireEvent.press(screen.getByRole('button', { name: 'Back to home' }));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalledWith('/');
  });
});

describe('CartScreen price-change modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseColorScheme.mockReturnValue('light');
    mockUseAuthStatus.mockReturnValue(buildAuthStatus());
    mockRouterCanGoBack.mockReturnValue(false);
    mockCartState = createMockCartState();
    mockRepriceResult = {
      priceChanges: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };
  });

  it('surfaces the price-change modal when reprice reports a drift', () => {
    mockRepriceResult = {
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
    mockRepriceResult = {
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
    mockRepriceResult = {
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

    mockRepriceResult = {
      priceChanges: [],
      dismissPriceChanges: mockDismissPriceChanges,
    };
    rerender(<CartScreen />);
    expect(screen.queryByTestId('ad-slot-CART_MPU')).toBeNull();

    // The price-change modal is the tree's only Modal wired with onDismiss.
    const priceChangeModal = UNSAFE_getAllByType(Modal).find(
      (modal) => typeof modal.props.onDismiss === 'function'
    );
    act(() => {
      priceChangeModal?.props.onDismiss();
    });
    expect(screen.getByTestId('ad-slot-CART_MPU')).toBeTruthy();
  });
});
