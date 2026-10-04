import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { RepriceResult } from '@/services/cart-reprice';
import type { CartItem } from '@/stores/cart-store.types';
import { createOrderResponseFixture } from './checkout-order-response-fixture';
import { useCheckoutSubmit } from './use-checkout-submit';
import { address, cartItem, createParams } from './use-checkout-submit.setup';

const mockRepriceCartItems = jest.fn() as jest.MockedFunction<
  (items: CartItem[], merchantId: string) => Promise<RepriceResult>
>;
const mockCreateOrder =
  jest.fn<typeof import('@/services/orders').createOrder>();
const mockSubmitBnplCheckout = jest.fn();
const mockBuildCheckoutOrderRequest = jest.fn();
const mockValidateCheckoutSubmission =
  jest.fn<
    typeof import('./checkout-submit-validation').validateCheckoutSubmission
  >();
const mockRepriceItems = jest.fn();
const mockRestoreItems = jest.fn<
  (
    items: CartItem[],
    cartWideNegotiationActive?: boolean,
    checkoutGeneration?: string
  ) => Promise<void>
>(async () => undefined);
const mockUseMerchant = jest.fn() as jest.MockedFunction<
  () => { data: { id: string } | null }
>;
let cartItems: CartItem[] = [];

jest.mock('@/services/cart-reprice', () => ({
  repriceCartItems: (items: CartItem[], merchantId: string) =>
    mockRepriceCartItems(items, merchantId),
  pickChangedPriceById: (result: {
    changes: { id: string }[];
    priceById: Record<string, number>;
  }) => {
    const out: Record<string, number> = {};
    for (const change of result.changes) {
      const live = result.priceById[change.id];
      if (typeof live === 'number') out[change.id] = live;
    }
    return out;
  },
}));

jest.mock('@/services/orders', () => ({
  // Lazy wrapper (not `createOrder: mockCreateOrder`): jest hoists this factory
  // above the `const mockCreateOrder`, so an eager binding captures `undefined`.
  // Typed args keep it compatible with the typed mock.
  createOrder: (
    ...args: Parameters<typeof import('@/services/orders').createOrder>
  ) => mockCreateOrder(...args),
}));

jest.mock('@/lib/wallet-payment-helpers', () => ({
  buildSavingsOrderFields: jest.fn(() => ({})),
  buildWalletOrderFields: jest.fn(() => ({})),
  getFullyPaidStoreCreditPaymentMethod: jest.fn(() => undefined),
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutStep: jest.fn(),
}));

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  trackCheckoutRoutePurchaseCompleted: jest.fn(),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: jest.fn(),
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => mockUseMerchant(),
}));

jest.mock('./checkout-bnpl-submit', () => ({
  submitBnplCheckout: (...args: unknown[]) => mockSubmitBnplCheckout(...args),
}));

jest.mock('./checkout-order-builders', () => ({
  buildCheckoutOrderRequest: (...args: unknown[]) =>
    mockBuildCheckoutOrderRequest(...args),
  createCheckoutSnapshot: jest.fn(() => ({
    deliveryFee: 1500,
    subtotal: 1200000,
    taxAmount: 0,
    total: 1201500,
  })),
}));

jest.mock('./checkout-payment-finalization', () => ({
  finalizeCheckoutPayment: jest.fn(),
}));

jest.mock('./checkout-post-order-side-effects', () => ({
  runCheckoutPostOrderSideEffects: jest.fn(),
}));

jest.mock('./checkout-store-credit', () => ({
  resolveCheckoutStoreCreditSelections: jest.fn(() => ({
    liveSavingsSelection: undefined,
    liveWalletSelection: undefined,
  })),
}));

jest.mock('./checkout-submit-error', () => ({
  handleCheckoutSubmitError: jest.fn(),
}));

jest.mock('./checkout-submit-validation', () => ({
  validateCheckoutSubmission: (
    input: Parameters<
      typeof import('./checkout-submit-validation').validateCheckoutSubmission
    >[0]
  ) => mockValidateCheckoutSubmission(input),
}));

const mockResolvePersistedRedvaultOrder = jest.fn(
  async (
    _input: unknown
  ): Promise<{
    blocked: boolean;
    orderId?: string;
    paidOrderId?: string;
  }> => ({
    blocked: false,
  })
);
const mockReadPersistedRedvaultOrder = jest.fn<
  () => Promise<
    import('@/lib/pending-redvault-order').PersistedRedvaultOrder | null
  >
>(async () => null);
const mockClearPersistedRedvaultOrder = jest.fn(async () => undefined);

jest.mock('@/lib/pending-redvault-order', () => ({
  resolvePersistedRedvaultOrder: (input: unknown) =>
    mockResolvePersistedRedvaultOrder(input),
  readPersistedRedvaultOrder: () => mockReadPersistedRedvaultOrder(),
  clearPersistedRedvaultOrder: () => mockClearPersistedRedvaultOrder(),
}));

const mockRouterReplace = jest.fn<(href: unknown) => void>();
const mockRouterPush = jest.fn<(href: unknown) => void>();

jest.mock('expo-router', () => ({
  router: {
    replace: (href: unknown) => mockRouterReplace(href),
    push: (href: unknown) => mockRouterPush(href),
  },
}));

const mockFenceFetchJson = jest.fn(async () => ({
  order: {
    id: 'order-rv',
    payment_status: 'unpaid',
    shipping_status: 'pending',
  },
}));

jest.mock('@/lib/storefront-customer-api-client', () => ({
  createStorefrontCustomerApiClient: () => ({
    fetchJson: () => mockFenceFetchJson(),
  }),
}));

const mockedUseCartStore = (
  jest.requireMock('@/stores/cart-store') as {
    useCartStore: jest.Mock & {
      getState?: () => {
        items: CartItem[];
        repriceItems: typeof mockRepriceItems;
        restoreItems: typeof mockRestoreItems;
      };
    };
  }
).useCartStore;

describe('useCheckoutSubmit REDVAULT fence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cartItems = [cartItem];
    mockUseMerchant.mockReturnValue({ data: { id: 'merchant-1' } });
    mockedUseCartStore.getState = () => ({
      items: cartItems,
      checkoutGeneration: 'gen-1',
      cartWideNegotiationActive: false,
      repriceItems: mockRepriceItems,
      restoreItems: mockRestoreItems,
    });
    mockValidateCheckoutSubmission.mockReturnValue(true);
    mockCreateOrder.mockResolvedValue(
      createOrderResponseFixture({
        effectiveCheckoutGeneration: 'gen-1',
      })
    );
    jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // Suppress native alerts in tests.
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not create a REDVAULT order without a review callback', async () => {
    const params = createParams({
      onRedvaultOrder: undefined,
      selectedPayment: 'uba_redvault',
    });
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Unable to continue',
      expect.stringMatching(/review is unavailable/i)
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(params.isOrderInFlight.current).toBe(false);
  });
});
