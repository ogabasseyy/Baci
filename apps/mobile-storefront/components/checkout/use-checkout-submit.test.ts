import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import type { CartPriceChange, RepriceResult } from '@/services/cart-reprice';
import type { CartItem } from '@/stores/cart-store.types';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
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
const mockRestoreItems = jest.fn();
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

describe('useCheckoutSubmit', () => {
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
    // validateCheckoutSubmission returns true when the submission is valid
    // (proceed). Default to valid so the freeze step, which now runs after
    // validation, is reached.
    mockValidateCheckoutSubmission.mockReturnValue(true);
    mockCreateOrder.mockResolvedValue({
      amountDueToGateway: 1201500,
      order: {
        created_at: '2026-07-09T12:00:00.000Z',
        id: 'order-1',
        order_number: 'ORD-1',
        payment_status: 'pending',
        shipping_status: 'pending',
        total: 1201500,
      },
      wallet: null,
    });
    jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // Suppress native alerts in tests.
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks checkout of a mixed prize + paid cart before creating an order', async () => {
    // A voucher (prize) line redeems as its own pre-reserved order; the server
    // ignores the other items and the success path clears the cart, so a mixed
    // cart would lose the paid line. Checkout must refuse before repricing or
    // order creation.
    cartItems = [
      cartItem,
      {
        id: 'line-prize',
        name: 'iPhone 15 (Prize)',
        price: 0,
        product_id: 'product-prize',
        quantity: 1,
        slug: 'iphone-15',
        voucher_token: 'qv1.aaa.bbb',
        voucher_award_id: 'award-1',
      },
    ];
    const params = createParams();

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Check out your prize separately',
      expect.stringContaining('redeemed on its own order'),
      [{ text: 'OK' }]
    );
    expect(mockRepriceCartItems).not.toHaveBeenCalled();
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(params.isOrderInFlight.current).toBe(false);
  });

  it('routes a voucher-only cart through the standard order path even when BNPL is selected', async () => {
    // A ₦0 prize must never take a BNPL/financing flow (which bypasses the
    // fully-paid success route and would open a ₦0 loan). It goes through
    // createOrder → finalize, which returns the pre-reserved paid order.
    cartItems = [
      {
        id: 'line-prize',
        name: 'iPhone 15 (Prize)',
        price: 0,
        product_id: 'product-prize',
        quantity: 1,
        slug: 'iphone-15',
        voucher_token: 'qv1.aaa.bbb',
        voucher_award_id: 'award-1',
      },
    ];
    mockRepriceCartItems.mockResolvedValue({ changes: [], priceById: {} });
    const params = createParams({ selectedPayment: 'credit_direct' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // Standard path taken (createOrder called); BNPL flow NOT taken.
    expect(mockCreateOrder).toHaveBeenCalled();
    expect(mockCreateOrder).toHaveBeenCalledWith(expect.anything(), {
      checkoutGeneration: 'gen-1',
    });
    expect(mockSubmitBnplCheckout).not.toHaveBeenCalled();
  });

  it('forces a non-POD method for a voucher-only cart so the prize order is marked paid', async () => {
    // The voucher RPC keys payment_status off the method: POD → pending, else →
    // paid. A ₦0 prize with pay-on-delivery selected must still complete, so the
    // order is submitted with a non-POD method.
    cartItems = [
      {
        id: 'line-prize',
        name: 'iPhone 15 (Prize)',
        price: 0,
        product_id: 'product-prize',
        quantity: 1,
        slug: 'iphone-15',
        voucher_token: 'qv1.aaa.bbb',
        voucher_award_id: 'award-1',
      },
    ];
    mockRepriceCartItems.mockResolvedValue({ changes: [], priceById: {} });
    const params = createParams({ selectedPayment: 'pay_on_delivery' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockBuildCheckoutOrderRequest).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodForOrder: 'card' })
    );
  });

  it('updates stale cart prices and aborts checkout after validation passes', async () => {
    const changes: CartPriceChange[] = [
      {
        id: 'line-1',
        name: 'iPhone 15 Pro',
        oldPrice: 1200000,
        newPrice: 1250000,
      },
    ];
    mockRepriceCartItems.mockResolvedValue({
      changes,
      priceById: { 'line-1': 1250000 },
    });
    const setIsProcessing = jest.fn();
    const params = createParams({ setIsProcessing });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRepriceCartItems).toHaveBeenCalledWith([cartItem], 'merchant-1');
    expect(mockRepriceItems).toHaveBeenCalledWith({ 'line-1': 1250000 });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Prices updated',
      expect.stringContaining('please review the new total'),
      [{ text: 'OK' }]
    );
    // Validation runs before the freeze step, then the processing lock is
    // engaged before repricing. A drift abort releases that lock in finally.
    expect(mockValidateCheckoutSubmission).toHaveBeenCalled();
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(setIsProcessing).toHaveBeenNthCalledWith(1, true);
    expect(setIsProcessing).toHaveBeenLastCalledWith(false);
    expect(params.isOrderInFlight.current).toBe(false);
  });

  it('engages the in-flight lock before async repricing to block double taps', async () => {
    let resolveReprice: (value: RepriceResult) => void = () => undefined;
    const validationInFlightStates: boolean[] = [];
    mockRepriceCartItems.mockImplementation(
      () =>
        new Promise<RepriceResult>((resolve) => {
          resolveReprice = resolve;
        })
    );
    mockValidateCheckoutSubmission.mockImplementation(
      (input: { isOrderInFlight: MutableRefObject<boolean> }) => {
        validationInFlightStates.push(input.isOrderInFlight.current);
        return !input.isOrderInFlight.current;
      }
    );
    const params = createParams();

    const { result } = renderHook(() => useCheckoutSubmit(params));

    let firstSubmit: Promise<void> | undefined;
    await act(async () => {
      firstSubmit = result.current(address);
      await Promise.resolve();
    });

    expect(params.isOrderInFlight.current).toBe(true);

    await act(async () => {
      await result.current(address);
    });

    expect(mockValidateCheckoutSubmission).toHaveBeenCalledTimes(2);
    expect(validationInFlightStates).toEqual([false, true]);
    expect(mockRepriceCartItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReprice({
        changes: [],
        priceById: { 'line-1': 1200000 },
      });
      await firstSubmit;
    });

    expect(params.isOrderInFlight.current).toBe(false);
  });

  it('proceeds past the freeze step into order creation when prices are unchanged', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    const setIsProcessing = jest.fn();
    const params = createParams({ setIsProcessing });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockValidateCheckoutSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        itemsLength: 1,
        selectedPayment: 'paystack',
      })
    );
    expect(mockRepriceCartItems).toHaveBeenCalledWith([cartItem], 'merchant-1');
    // No drift → cart is not mutated and no alert; the submit advances into
    // the order path (processing state set, order marked in-flight).
    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    // setIsProcessing(true) is the reliable marker that the submit advanced
    // past the freeze into the order path (isOrderInFlight is reset by the
    // downstream finally handler once the mocked order path settles).
    expect(setIsProcessing).toHaveBeenCalledWith(true);
  });

  it('falls back to the configured merchant id when merchant context has not loaded', async () => {
    mockUseMerchant.mockReturnValue({ data: null });
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    const params = createParams();

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRepriceCartItems).toHaveBeenCalledWith(
      [cartItem],
      CHECKOUT_MERCHANT_ID
    );
  });

  it('treats a blank placeholder merchant id as missing and uses the constant', async () => {
    // useMerchant returns placeholder data whose id is '' when Expo extra is
    // not injected; `||` must fall back rather than reprice with an empty id.
    mockUseMerchant.mockReturnValue({ data: { id: '' } });
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });

    const { result } = renderHook(() => useCheckoutSubmit(createParams()));

    await act(async () => {
      await result.current(address);
    });

    expect(mockRepriceCartItems).toHaveBeenCalledWith(
      [cartItem],
      CHECKOUT_MERCHANT_ID
    );
  });

  it('skips repricing entirely when validation fails', async () => {
    mockValidateCheckoutSubmission.mockReturnValue(false);
    const setIsProcessing = jest.fn();
    const params = createParams({ setIsProcessing });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // Freeze runs after validation, so an invalid (e.g. in-flight) submit is
    // rejected before any reprice round-trip, cart mutation, or order.
    expect(mockValidateCheckoutSubmission).toHaveBeenCalled();
    expect(mockRepriceCartItems).not.toHaveBeenCalled();
    expect(mockRepriceItems).not.toHaveBeenCalled();
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(setIsProcessing).not.toHaveBeenCalled();
    expect(params.isOrderInFlight.current).toBe(false);
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
