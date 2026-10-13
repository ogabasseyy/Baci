import { jest } from '@jest/globals';

// Shared mocks, builders, and module factories for the cart suites (state +
// theming + price-change modal). Pure module on purpose: jest.mock hoisting
// is per-file, so each suite registers its own mocks by calling these
// factories. Factories are mock-prefixed because factory bodies may only
// reference mock-prefixed imports. Mutable store snapshots live in holder
// objects (imports cannot be reassigned); each suite resets them.

export type MockAuthStatus = {
  customer: null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  user: { id: string } | null;
};

export type MockPriceChange = {
  id: string;
  name: string;
  oldPrice: number;
  newPrice: number;
};

export const mockOpenNegotiation = jest.fn();
export const mockUseColorScheme = jest.fn(() => 'dark');
export const mockQueryClient = { prefetchQuery: jest.fn() };
export const mockWarmCheckoutEntry = jest.fn();
export const mockDismissPriceChanges = jest.fn();
export const mockRepriceHolder: {
  current: {
    priceChanges: MockPriceChange[];
    dismissPriceChanges: typeof mockDismissPriceChanges;
  };
} = {
  current: {
    priceChanges: [],
    dismissPriceChanges: mockDismissPriceChanges,
  },
};
export const mockRouterPrefetch = jest.fn();
export const mockRouterPush = jest.fn();
export const mockRouterReplace = jest.fn();
export const mockRouterBack = jest.fn();
export const mockRouterCanGoBack = jest.fn(() => false);

export const buildAuthStatus = (
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
export const mockUseAuthStatus = jest.fn(
  (): MockAuthStatus => buildAuthStatus()
);

export const createMockCartState = (
  overrides: Record<string, unknown> = {}
) => ({
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

export const mockCartStateHolder: { current: Record<string, unknown> } = {
  current: createMockCartState(),
};

export function mockExpoRouterModule(): unknown {
  return {
    router: {
      back: (...args: unknown[]) => mockRouterBack(...args),
      canGoBack: () => mockRouterCanGoBack(),
      prefetch: (...args: unknown[]) => mockRouterPrefetch(...args),
      push: (...args: unknown[]) => mockRouterPush(...args),
      replace: (...args: unknown[]) => mockRouterReplace(...args),
    },
    useIsFocused: () => true,
  };
}

export function mockReactQueryModule(): unknown {
  return { useQueryClient: () => mockQueryClient };
}

export function mockCheckoutEntryPrefetchModule(): unknown {
  return {
    warmCheckoutEntry: (...args: unknown[]) => mockWarmCheckoutEntry(...args),
  };
}

export function mockCartRepriceModule(): unknown {
  return { useCartReprice: () => mockRepriceHolder.current };
}

export function mockAdSlotModule(): unknown {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AdSlot: ({ placement }: { placement: string }) =>
      React.createElement(View, { testID: `ad-slot-${placement}` }),
  };
}

export function mockHapticsModule(): unknown {
  return {
    impactAsync: jest.fn(() => Promise.resolve()),
    ImpactFeedbackStyle: { Light: 'light' },
  };
}

export function mockShallowModule(): unknown {
  return { useShallow: <T,>(selector: T) => selector };
}

export function mockReanimatedModule(): unknown {
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
}

export function mockColorSchemeModule(): unknown {
  return { useColorScheme: () => mockUseColorScheme() };
}

export function mockCheckoutIdentityModule(): unknown {
  const { Text: MockText } =
    jest.requireActual<typeof import('react-native')>('react-native');

  return {
    CheckoutIdentityModal: ({ isOpen }: { isOpen: boolean }) => {
      if (!isOpen) return null;
      return <MockText>Checkout Identity Modal</MockText>;
    },
  };
}

export function mockSafeImageModule(): unknown {
  return {
    SafeImage: function MockSafeImage() {
      return null;
    },
  };
}

export function mockCartStoreModule(): unknown {
  return {
    formatPrice: (value: number) =>
      `₦${new Intl.NumberFormat('en-NG').format(value)}`,
    useCartStore: (selector: (state: Record<string, unknown>) => unknown) =>
      selector(mockCartStateHolder.current),
  };
}

export function mockAuthGuardModule(): unknown {
  return { useAuthStatus: () => mockUseAuthStatus() };
}

export function mockSafeAreaModule(): unknown {
  return {
    useSafeAreaInsets: () => ({
      top: 16,
      right: 0,
      bottom: 0,
      left: 0,
    }),
  };
}

export function mockUIStoreModule(): unknown {
  return {
    useUIStore: (
      selector: (state: {
        openNegotiation: typeof mockOpenNegotiation;
      }) => unknown
    ) => selector({ openNegotiation: mockOpenNegotiation }),
  };
}

export function setupCartMocks(colorScheme: 'dark' | 'light' = 'dark'): void {
  jest.clearAllMocks();
  mockUseColorScheme.mockReturnValue(colorScheme);
  mockUseAuthStatus.mockReturnValue(buildAuthStatus());
  mockRouterCanGoBack.mockReturnValue(false);
  mockCartStateHolder.current = createMockCartState();
  mockRepriceHolder.current = {
    priceChanges: [],
    dismissPriceChanges: mockDismissPriceChanges,
  };
}
