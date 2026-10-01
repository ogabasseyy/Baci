import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';
import type { CartPriceChange, RepriceResult } from '@/services/cart-reprice';
import type { CartItem } from '@/stores/cart-store.types';
import { createOrderResponseFixture } from './checkout-order-response-fixture';
import { CHECKOUT_MERCHANT_ID } from './checkout-screen.constants';
import { useCheckoutSubmit } from './use-checkout-submit';
import { address, cartItem, createParams } from './use-checkout-submit.setup';

const mockRepriceCartItems = jest.fn() as jest.MockedFunction<
  (items: CartItem[], merchantId: string) => Promise<RepriceResult>
>;
const mockCreateOrder =
  jest.fn<typeof import('@/services/orders').createOrder>();
const mockSubmitBnplCheckout =
  jest.fn<typeof import('./checkout-bnpl-submit').submitBnplCheckout>();
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
  trackCheckoutInvoiceGenerated: jest.fn(),
  trackCheckoutStep: jest.fn(),
}));

jest.mock('@/services/tiktok-checkout-route-tracking', () => ({
  // Async like the real tracker: the finalizer shares the in-flight
  // emission promise with the completion lane.
  trackCheckoutRoutePurchaseCompleted: jest.fn(async () => undefined),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: jest.fn(),
}));

jest.mock('@/hooks/use-merchant', () => ({
  useMerchant: () => mockUseMerchant(),
}));

jest.mock('./checkout-bnpl-submit', () => ({
  submitBnplCheckout: (
    ...args: Parameters<
      typeof import('./checkout-bnpl-submit').submitBnplCheckout
    >
  ) => mockSubmitBnplCheckout(...args),
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
    mockCreateOrder.mockResolvedValue(
      createOrderResponseFixture({
        effectiveCheckoutGeneration: 'gen-1',
      })
    );
    jest.spyOn(Alert, 'alert').mockImplementation(() => {
      // Suppress native alerts in tests.
    });
  });

  it('blocks a non-REDVAULT submit while a persisted REDVAULT fence is unresolved', async () => {
    mockReadPersistedRedvaultOrder.mockResolvedValueOnce({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-0',
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    mockResolvePersistedRedvaultOrder.mockResolvedValueOnce({
      blocked: true,
      orderId: 'order-rv',
    });
    const params = createParams({ selectedPayment: 'paystack' });
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockResolvePersistedRedvaultOrder).toHaveBeenCalledWith(
      expect.objectContaining({ validateOrder: expect.any(Function) })
    );
    expect(Alert.alert).toHaveBeenCalledWith(
      'Payment still processing',
      expect.stringMatching(/still being verified/i)
    );
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(params.isOrderInFlight.current).toBe(false);
  });

  it('resolves the fence for REDVAULT submits and recreates once terminal', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockReadPersistedRedvaultOrder.mockResolvedValueOnce({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-0',
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    mockResolvePersistedRedvaultOrder.mockResolvedValueOnce({
      blocked: false,
    });
    const params = createParams({
      onRedvaultOrder: jest.fn(),
      selectedPayment: 'uba_redvault',
    });
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockResolvePersistedRedvaultOrder).toHaveBeenCalledWith(
      expect.objectContaining({ validateOrder: expect.any(Function) })
    );
    expect(mockCreateOrder).toHaveBeenCalled();
  });

  it('routes a REDVAULT resubmit to the paid fence instead of recreating', async () => {
    mockReadPersistedRedvaultOrder.mockResolvedValueOnce({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-0',
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    mockResolvePersistedRedvaultOrder.mockResolvedValueOnce({
      blocked: false,
      paidOrderId: 'order-rv',
    });
    const params = createParams({
      onRedvaultOrder: jest.fn(),
      selectedPayment: 'uba_redvault',
    });
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(params.clearCart).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/order-success',
        params: expect.objectContaining({ orderId: 'order-rv' }),
      })
    );
  });

  it('routes a non-REDVAULT submit to the paid fence instead of recreating', async () => {
    mockReadPersistedRedvaultOrder.mockResolvedValueOnce({
      orderId: 'order-rv',
      checkoutGeneration: 'gen-0',
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    mockResolvePersistedRedvaultOrder.mockResolvedValueOnce({
      blocked: false,
      paidOrderId: 'order-rv',
    });
    const params = createParams({ selectedPayment: 'paystack' });
    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(params.clearCart).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/order-success',
        params: expect.objectContaining({ orderId: 'order-rv' }),
      })
    );
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
    // Creation attributes to the selected BNPL method through the
    // finalization tracking call.
    const { trackCheckoutRoutePurchaseCompleted } = jest.requireMock(
      '@/services/tiktok-checkout-route-tracking'
    ) as { trackCheckoutRoutePurchaseCompleted: jest.Mock };
    expect(mockCreateOrder).toHaveBeenCalled();
    expect(mockSubmitBnplCheckout).not.toHaveBeenCalled();
    expect(trackCheckoutRoutePurchaseCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'credit_direct' })
    );
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

  it('defers invoice_generated for an unpaid invoice order with an amount due', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockResolvedValue({
      amountDueToGateway: 1201500,
      effectiveCheckoutGeneration: 'gen-1',
      order: {
        created_at: '2026-07-09T12:00:00.000Z',
        id: 'order-invoice-unpaid',
        order_number: 'ORD-INV-1',
        payment_status: 'pending',
        shipping_status: 'pending',
        total: 1201500,
      },
      wallet: null,
    });
    const { trackCheckoutInvoiceGenerated } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutInvoiceGenerated: jest.Mock };
    const params = createParams({ selectedPayment: 'invoice' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // The server builds the artifacts asynchronously in after(): submit
    // must not book the conversion — the success screen captures it once
    // the lookup carries the terminal delivery flag.
    expect(trackCheckoutInvoiceGenerated).not.toHaveBeenCalled();
  });

  it('defers invoice_generated for a zero-total unpaid invoice order', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    // A 100% discount zeroes the gateway amount while the order stays
    // unpaid; the server still generates and emails the proforma — but
    // asynchronously, so submit still must not record it.
    mockCreateOrder.mockResolvedValue({
      amountDueToGateway: 0,
      effectiveCheckoutGeneration: 'gen-1',
      order: {
        created_at: '2026-07-09T12:00:00.000Z',
        id: 'order-invoice-zero',
        order_number: 'ORD-INV-0',
        payment_status: 'pending',
        shipping_status: 'pending',
        total: 0,
      },
      wallet: null,
    });
    const { trackCheckoutInvoiceGenerated } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutInvoiceGenerated: jest.Mock };
    const params = createParams({ selectedPayment: 'invoice' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(trackCheckoutInvoiceGenerated).not.toHaveBeenCalled();
  });

  it('skips invoice_generated when wallet coverage pays a selected invoice order in full', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    mockCreateOrder.mockResolvedValue({
      amountDueToGateway: 0,
      effectiveCheckoutGeneration: 'gen-1',
      order: {
        created_at: '2026-07-09T12:00:00.000Z',
        id: 'order-invoice-paid',
        order_number: 'ORD-INV-2',
        payment_status: 'paid',
        shipping_status: 'pending',
        total: 1201500,
      },
      wallet: { amountUsed: 1201500, newBalance: 0, transactionId: 'tx-1' },
    });
    const { trackCheckoutInvoiceGenerated } = jest.requireMock(
      '@/services/analytics'
    ) as { trackCheckoutInvoiceGenerated: jest.Mock };
    const params = createParams({ selectedPayment: 'invoice' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // No unpaid proforma outcome occurred: the order routes straight to
    // paid completion and must not also book a proforma conversion.
    expect(trackCheckoutInvoiceGenerated).not.toHaveBeenCalled();
  });

  it('engages the in-flight lock before fence resolution to block double taps', async () => {
    mockRepriceCartItems.mockResolvedValue({
      changes: [],
      priceById: { 'line-1': 1200000 },
    });
    let resolvePersistedRead: (value: null) => void = () => undefined;
    mockReadPersistedRedvaultOrder.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolvePersistedRead = resolve;
        })
    );
    const validationInFlightStates: boolean[] = [];
    mockValidateCheckoutSubmission.mockImplementation(
      (input: { isOrderInFlight: MutableRefObject<boolean> }) => {
        validationInFlightStates.push(input.isOrderInFlight.current);
        return !input.isOrderInFlight.current;
      }
    );
    const params = createParams({ selectedPayment: 'paystack' });

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
    expect(mockCreateOrder).not.toHaveBeenCalled();

    await act(async () => {
      resolvePersistedRead(null);
      await firstSubmit;
    });

    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
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

  it('preserves the payforme method so the server dispatches the payment request', async () => {
    mockRepriceCartItems.mockResolvedValue({ changes: [], priceById: {} });
    const params = createParams({ selectedPayment: 'payforme' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // Pay for Me keeps its own persisted identity (never collapsed to
    // invoice): the server keys its explicit dispatch branch — payment
    // request email plus transfer details — off this stored method.
    expect(mockBuildCheckoutOrderRequest).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethodForOrder: 'payforme' })
    );
    expect(mockCreateOrder).toHaveBeenCalled();
  });

  it('threads the nested Klump order id into init failures', async () => {
    mockRepriceCartItems.mockResolvedValue({ changes: [], priceById: {} });
    const initError = new Error('klump init failed');
    mockSubmitBnplCheckout.mockImplementation((params) => {
      params.onOrderCreated?.('order-klump-1');
      throw initError;
    });
    const { handleCheckoutSubmitError } = jest.requireMock(
      './checkout-submit-error'
    ) as { handleCheckoutSubmitError: jest.Mock };
    const params = createParams({ selectedPayment: 'klump' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // The nested BNPL submit committed order-klump-1 before Klump init
    // threw: the outer catch must report with that identity.
    expect(handleCheckoutSubmitError).toHaveBeenCalledWith(
      initError,
      'klump',
      'order-klump-1'
    );
    expect(params.isOrderInFlight.current).toBe(false);
  });

  it('threads the committed order id into post-creation init failures', async () => {
    mockRepriceCartItems.mockResolvedValue({ changes: [], priceById: {} });
    const initError = new Error('provider init threw');
    const { finalizeCheckoutPayment } = jest.requireMock(
      './checkout-payment-finalization'
    ) as { finalizeCheckoutPayment: jest.Mock };
    finalizeCheckoutPayment.mockImplementation(() => {
      throw initError;
    });
    const { handleCheckoutSubmitError } = jest.requireMock(
      './checkout-submit-error'
    ) as { handleCheckoutSubmitError: jest.Mock };
    const params = createParams({ selectedPayment: 'paystack' });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    // createOrder committed order-1 before finalization threw: the error
    // path must carry the id so the funnel failure joins to the order.
    expect(mockCreateOrder).toHaveBeenCalled();
    expect(handleCheckoutSubmitError).toHaveBeenCalledWith(
      initError,
      'paystack',
      'order-1'
    );
    expect(params.isOrderInFlight.current).toBe(false);
  });

  it('attributes completion to the auth user id, not the customer-row id', async () => {
    // The server conversion payload joins on external_id: the signed-in
    // auth identity wins cross-device matching, never the storefront
    // customer row.
    mockRepriceCartItems.mockResolvedValue({ changes: [], priceById: {} });
    // Unique order identity: the durable purchase claim persists across
    // tests in this file, so reusing the default order would read as an
    // already-recorded conversion and skip the tracking under test.
    mockCreateOrder.mockResolvedValue(
      createOrderResponseFixture({
        orderId: 'order-auth-1',
        orderNumber: 'ORD-A1',
      })
    );
    const { trackCheckoutRoutePurchaseCompleted } = jest.requireMock(
      '@/services/tiktok-checkout-route-tracking'
    ) as { trackCheckoutRoutePurchaseCompleted: jest.Mock };
    const params = createParams({
      customer: { email: 'customer@example.com', id: 'customer-row-1' },
      isAuthenticated: true,
      selectedPayment: 'paystack',
      user: { id: 'auth-user-1' },
    });

    const { result } = renderHook(() => useCheckoutSubmit(params));

    await act(async () => {
      await result.current(address);
    });

    expect(mockCreateOrder).toHaveBeenCalled();
    expect(trackCheckoutRoutePurchaseCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-auth-1',
        userId: 'auth-user-1',
      })
    );
  });
});
