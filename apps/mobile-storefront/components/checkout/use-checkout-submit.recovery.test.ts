import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import type { RepriceResult } from '@/services/cart-reprice';
import type { CartItem } from '@/stores/cart-store.types';
import {
  type UseCheckoutSubmitParams,
  useCheckoutSubmit,
} from './use-checkout-submit';

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

const cartItem: CartItem = {
  id: 'line-1',
  name: 'iPhone 15 Pro',
  price: 1200000,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-15-pro',
};

const address = {
  address: '1 Test Way',
  city: 'Ikeja',
  email: 'customer@example.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  phone: '08012345678',
  state: 'Lagos',
};

function createRef<T>(current: T): MutableRefObject<T> {
  return { current };
}

function createParams(
  overrides: Partial<UseCheckoutSubmitParams> = {}
): UseCheckoutSubmitParams {
  return {
    accountPassword: '',
    appliedDiscountCode: null,
    availablePaymentMethods: ['paystack'],
    clearCart: jest.fn<() => void | Promise<void>>(),
    currentShippingQuoteContextKey: 'door:Lagos:Ikeja',
    customer: null,
    deliveryFee: 1500,
    deliveryMethod: 'door',
    getLiveSavingsSelection:
      jest.fn<UseCheckoutSubmitParams['getLiveSavingsSelection']>(),
    getShippingProvider: () => 'gigl',
    isAuthenticated: false,
    isLoadingQuotes: false,
    isOrderInFlight: createRef(false),
    isProcessing: false,
    mobileCheckoutIdempotencyRef: createRef(null),
    orderTotals: { taxAmount: 0 },
    paymentSettings: { klump_enabled: true },
    paymentTab: 'full',
    resolvedShippingQuoteContextKey: 'door:Lagos:Ikeja',
    requiresShippingQuote: true,
    saveAsDefaultAddress: false,
    saveDetails: false,
    selectedPayment: 'paystack',
    selectedQuote: undefined,
    selectedSavedAddressId: null,
    setIsProcessing: jest.fn(),
    setPendingOrder: jest.fn(),
    setShowCryptoSelection: jest.fn(),
    setStep: jest.fn(),
    user: null,
    walletBalance: 0,
    walletFundedBankTransferOptionEnabled: false,
    walletSelection: undefined,
    ...overrides,
  };
}

describe('useCheckoutSubmit recovery', () => {
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
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('restores the pre-submit checkout generation when order creation fails after the cart is cleared', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockImplementation(async () => {
      cartItems = [];
      throw new Error('payment init failed');
    });
    const params = createParams();
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRestoreItems).toHaveBeenCalledWith([cartItem], false, 'gen-1');
  });

  it('still reports the original checkout error when restore persistence rejects', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    const checkoutError = new Error('payment init failed');
    mockCreateOrder.mockImplementation(async () => {
      cartItems = [];
      throw checkoutError;
    });
    mockRestoreItems.mockRejectedValueOnce(new Error('disk full'));
    const { handleCheckoutSubmitError } = jest.requireMock(
      './checkout-submit-error'
    ) as { handleCheckoutSubmitError: ReturnType<typeof jest.fn> };
    const params = createParams();
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(handleCheckoutSubmitError).toHaveBeenCalledWith(
      checkoutError,
      'paystack'
    );
  });

  it('tracks a recovered order on the first observed replay response', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockResolvedValue({
      amountDueToGateway: 1201500,
      idempotency: { replayed: true },
      order: {
        created_at: '2026-07-09T12:00:00.000Z',
        id: 'order-replay-1',
        order_number: 'ORD-R1',
        payment_status: 'pending',
        shipping_status: 'pending',
        total: 1201500,
      },
      wallet: null,
    });
    const { trackCheckoutRoutePurchaseCompleted } = jest.requireMock(
      '@/services/tiktok-checkout-route-tracking'
    ) as { trackCheckoutRoutePurchaseCompleted: ReturnType<typeof jest.fn> };
    const params = createParams();
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(trackCheckoutRoutePurchaseCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-replay-1' })
    );
  });
});
