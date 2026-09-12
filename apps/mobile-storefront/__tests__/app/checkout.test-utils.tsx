import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type React from 'react';
import { Alert } from 'react-native';
import type { PaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import './checkout.component-mocks.test-utils';
import { createCheckoutFetchMock } from './checkout.fetch.test-utils';

const mockRouterBack = jest.fn();
export const mockRouterPush = jest.fn();
export const mockRouterReplace = jest.fn();
const mockUseColorScheme = jest.fn(() => 'light');
export const mockAlert = jest.fn();
export const mockCreateOrder = jest.fn();
export const mockCreateWalletFundingAccount = jest.fn();
export const mockCreateOrderWalletFundingIntent = jest.fn();
export const mockListSavingsGoals = jest.fn();
export const mockTrackCheckoutStarted = jest.fn();
export const mockTrackCheckoutStep = jest.fn();
export const mockTrackError = jest.fn();
export const mockUseMerchantPaymentSettings = jest.fn<
  { data: PaymentSettings | null },
  []
>(() => ({ data: mockPaymentSettings }));
export const mockUseMerchant = jest.fn(() => ({
  data: {
    business_address: 'No. 5 Example Plaza, Ikeja, Lagos',
    business_name: 'OgaBassey',
    id: 'merchant-ogabassey',
    registered_address: {
      city: 'Ikeja',
      state: 'Lagos',
      street: 'No. 5 Example Plaza',
    },
  },
}));
export const mockCryptoRandomUUID = jest.fn();
let mockCryptoUuidCounter = 0;

type MockCheckoutCustomer = {
  email: string;
  first_name: string;
  id: string;
  last_name: string;
  phone: string;
};

type MockCheckoutUser = {
  id: string;
};

type MockAuthStatus = {
  customer: MockCheckoutCustomer | null;
  isAuthenticated: boolean;
  isGuest: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  user: MockCheckoutUser | null;
};

const defaultMockAuthStatus: MockAuthStatus = {
  customer: null,
  isAuthenticated: false,
  isGuest: true,
  isInitialized: true,
  isLoading: false,
  user: null,
};

const defaultMockPaymentSettings = {
  credit_direct_enabled: false,
  credpal_enabled: false,
  juicyway_enabled: false,
  klump_enabled: false,
  klump_max_amount: 0,
  klump_min_amount: 0,
  korapay_enabled: false,
  pay_on_delivery_enabled: false,
  paystack_enabled: true,
  vat_rate: 7.5,
  vat_registration_status: 'unregistered',
  wallet_order_auto_debit_enabled: false,
  wallet_paystack_dva_enabled: false,
};

export const mockPaymentSettings = { ...defaultMockPaymentSettings };

function resetMockPaymentSettings() {
  Object.assign(mockPaymentSettings, defaultMockPaymentSettings);
}

export const mockUseAuthStatus = jest.fn<MockAuthStatus, []>(
  () => defaultMockAuthStatus
);

export function getPaymentInitializeCalls() {
  return (global.fetch as jest.Mock).mock.calls.filter(([input]) => {
    const requestUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : ((input as { url?: string }).url ?? '');
    return requestUrl.includes('/api/payments/initialize');
  });
}

const mockCartState = {
  clearCart: jest.fn(),
  items: [
    {
      condition: 'New',
      id: 'cart-item-1',
      image_url: 'https://example.com/item.jpg',
      name: 'iPhone 11 Pro Max',
      price: 470000,
      product_id: 'product-1',
      quantity: 1,
      slug: 'iphone-11-pro-max',
      storage: '64GB',
    },
  ],
  subtotal: () => 470000,
};
const mockUseCartStore = Object.assign(
  (selector: (state: typeof mockCartState) => unknown) =>
    selector(mockCartState),
  {
    getState: () => mockCartState,
    persist: {
      getOptions: () => ({
        name: 'cart-storage',
        partialize: (state: unknown) => state,
        version: 0,
      }),
    },
  }
);

let originalFetch: typeof global.fetch = global.fetch;

jest.mock('expo-router', () => ({
  Stack: {
    Screen: () => null,
  },
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');

  const makeSharedValue = (value: number) => {
    let current = value;
    return {
      get: () => current,
      set: (next: number) => {
        current = next;
      },
    };
  };

  // Chainable no-op builder for entering/exiting/layout animations
  // (FadeIn.duration(180), ZoomIn.springify().damping(14), etc.).
  const makeAnimationBuilder = () => {
    const builder: Record<string, () => unknown> = {};
    const chain = () => builder;
    for (const key of ['duration', 'delay', 'springify', 'damping', 'easing']) {
      builder[key] = chain;
    }
    return builder;
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
    FadeIn: makeAnimationBuilder(),
    FadeOut: makeAnimationBuilder(),
    ZoomIn: makeAnimationBuilder(),
    ZoomOut: makeAnimationBuilder(),
    Layout: makeAnimationBuilder(),
    LinearTransition: makeAnimationBuilder(),
  };
});

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { View } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GadgetPattern: (props: Record<string, unknown>) => (
      <View testID="checkout-gadget-pattern" {...props} />
    ),
  };
});

jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (length: number) => new Uint8Array(length).fill(7),
  randomUUID: () => mockCryptoRandomUUID(),
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
    useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
  };
});

jest.mock('@/hooks/use-auth-guard', () => ({
  useAuthStatus: () => mockUseAuthStatus(),
}));

jest.mock('@/stores/cart-store', () => ({
  formatPrice: (value: number) =>
    `₦${new Intl.NumberFormat('en-NG').format(value)}`,
  useCartStore: mockUseCartStore,
}));

jest.mock('@/hooks/use-wallet', () => ({
  useWallet: () => ({
    data: {
      wallet: {
        balance: 0,
      },
    },
  }),
}));

jest.mock('@/hooks/useMerchantPaymentSettings', () => {
  const actual = jest.requireActual('@/hooks/useMerchantPaymentSettings');
  return {
    ...actual,
    useMerchantPaymentSettings: () => mockUseMerchantPaymentSettings(),
  };
});

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => mockUseMerchant(),
}));

jest.mock('@/lib/supabase', () => ({
  calculateCommerce: jest.fn(
    (
      _name: string,
      params: {
        assuranceFee: number;
        shippingFee: number;
        subtotal: number;
        taxRate: number;
      }
    ) => {
      const taxAmount = Math.round(params.subtotal * params.taxRate);
      return Promise.resolve({
        taxAmount,
        total:
          params.subtotal +
          params.shippingFee +
          params.assuranceFee +
          taxAmount,
      });
    }
  ),
  supabase: {
    from: jest.fn(() => ({
      eq: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(async () => ({
            data: { saved_addresses: [] },
            error: null,
          })),
        })),
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(async () => ({
              data: { saved_addresses: [] },
              error: null,
            })),
          })),
        })),
      })),
    })),
  },
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutStarted: (...args: unknown[]) =>
    mockTrackCheckoutStarted(...args),
  trackCheckoutStep: (...args: unknown[]) => mockTrackCheckoutStep(...args),
  trackError: (...args: unknown[]) => mockTrackError(...args),
  trackOrderCompleted: jest.fn(),
}));

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  // Checkout screen tests assert step/state transitions; loading native ad SDKs
  // here makes CI render timing depend on mocked native module initialization.
  trackCheckoutRoutePaymentInfo: jest.fn(() => Promise.resolve()),
  trackCheckoutRoutePurchaseCompleted: jest.fn(() => Promise.resolve()),
  trackCheckoutRouteStarted: jest.fn((...args: unknown[]) => {
    mockTrackCheckoutStarted(...args);
    return Promise.resolve();
  }),
}));

jest.mock('@/services/orders', () => ({
  OrderError: class extends Error {
    code: string;
    details?: unknown;

    constructor(message: string, code = 'TEST_ERROR', details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
  createOrder: (...args: unknown[]) => mockCreateOrder(...args),
}));

// Cart reprice runs before checkout submit; default to "no price drift" so
// these tests exercise the normal order path. Suites that want to test the
// reconcile/abort behavior can override this mock.
jest.mock('@/services/cart-reprice', () => {
  // Keep the real `pickChangedPriceById` so suites that override repricing to
  // return `changes` still exercise the drift-alert path instead of crashing
  // on a missing export.
  const actual = jest.requireActual<typeof import('@/services/cart-reprice')>(
    '@/services/cart-reprice'
  );
  return {
    ...actual,
    repriceCartItems: jest.fn(async () => ({ priceById: {}, changes: [] })),
  };
});

jest.mock('@/lib/customer-savings', () => ({
  listSavingsGoals: (...args: unknown[]) => mockListSavingsGoals(...args),
}));

// Screen tests exercise manual address entry; saved-address loading is
// covered by fetch-checkout-saved-addresses.test.ts.
jest.mock('@/lib/fetch-checkout-saved-addresses', () => ({
  fetchCheckoutSavedAddresses: jest.fn(async () => []),
}));

jest.mock('@/lib/order-wallet-funding-intent', () => ({
  createOrderWalletFundingIntent: (...args: unknown[]) =>
    mockCreateOrderWalletFundingIntent(...args),
}));

jest.mock('@/lib/wallet-funding-account', () => ({
  createWalletFundingAccount: (...args: unknown[]) =>
    mockCreateWalletFundingAccount(...args),
}));

jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: jest.fn(),
}));

const CheckoutScreen = require('@/app/checkout').default as React.ComponentType;

export function setupCheckoutTest() {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockCryptoUuidCounter = 0;
  mockCryptoRandomUUID.mockImplementation(
    () => `mobile-test-key-${++mockCryptoUuidCounter}`
  );
  jest.spyOn(Alert, 'alert').mockImplementation(mockAlert);
  mockUseAuthStatus.mockReturnValue(defaultMockAuthStatus);
  mockUseMerchantPaymentSettings.mockReturnValue({
    data: mockPaymentSettings,
  });
  mockUseMerchant.mockReturnValue({
    data: {
      business_address: 'No. 5 Example Plaza, Ikeja, Lagos',
      business_name: 'OgaBassey',
      id: 'merchant-ogabassey',
      registered_address: {
        city: 'Ikeja',
        state: 'Lagos',
        street: 'No. 5 Example Plaza',
      },
    },
  });
  mockCreateOrder.mockResolvedValue({
    amountDueToGateway: 1000,
    order: {
      id: 'order-1',
      order_number: 'ORD-001',
      payment_status: 'unpaid',
      shipping_status: 'pending',
      total: 470000,
      tracking_token: null,
    },
    savings: null,
    wallet: null,
  });
  resetMockPaymentSettings();
  mockCreateOrderWalletFundingIntent.mockResolvedValue({
    account: {
      accountName: 'Ogabassey Jane',
      accountNumber: '9971002551',
      bankName: 'Paystack-Titan',
      provider: 'paystack',
    },
    intent: {
      currency: 'NGN',
      expectedAmount: 470000,
      expiresAt: '2026-05-27T12:00:00.000Z',
      fundedAmount: 0,
      id: 'intent-123',
      orderId: 'order-1',
      status: 'pending',
      targetOrderAmount: 470000,
    },
  });
  mockCreateWalletFundingAccount.mockResolvedValue({
    account: {
      accountName: 'Ogabassey Jane',
      accountNumber: '9971002551',
      bankName: 'Paystack-Titan',
      provider: 'paystack',
    },
    requiresConsent: false,
  });
  mockListSavingsGoals.mockResolvedValue({
    goals: [],
    summary: {
      activeGoalCount: 0,
      savingsBalance: 0,
    },
  });
  originalFetch = global.fetch;
  global.fetch = createCheckoutFetchMock() as jest.Mock;
}

export function teardownCheckoutTest() {
  resetMockPaymentSettings();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
}

export function createCheckoutQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

export function renderCheckoutScreen() {
  const queryClient = createCheckoutQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <CheckoutScreen />
    </QueryClientProvider>
  );
}
