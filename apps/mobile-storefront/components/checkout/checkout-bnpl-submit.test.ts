import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ShippingAddressInput } from '@/lib/validation';
import type { OrderResponse } from '@/services/orders';
import type { CartItem } from '@/stores/cart-store';
import type { CheckoutSnapshot } from './checkout-order-builders';

const mockAlert = jest.fn();
const mockBuildCheckoutOrderRequest =
  jest.fn<(params: unknown) => Record<string, unknown>>();
const mockBuildKlumpBnplRouteParams =
  jest.fn<(params: unknown) => Record<string, unknown>>();
const mockBuildKlumpInitializePayload =
  jest.fn<(params: unknown) => Record<string, unknown>>();
const mockBuildMobileCheckoutOrderFingerprint =
  jest.fn<(params: unknown) => string>();
const mockClearMobileCheckoutIdempotencyKey =
  jest.fn<(...params: unknown[]) => void>();
const mockCreateOrder = jest.fn<(params: unknown) => Promise<OrderResponse>>();
const mockGetKlumpDisabledReason =
  jest.fn<(...params: unknown[]) => string | undefined>();
const mockGetMobileCheckoutIdempotencyKey =
  jest.fn<(...params: unknown[]) => string>();
const mockRouterPush = jest.fn();

jest.mock('react-native', () => ({
  Alert: {
    alert: mockAlert,
  },
}));

jest.mock('expo-router', () => ({
  router: {
    push: mockRouterPush,
  },
}));

jest.mock('@/lib/checkout-order-idempotency', () => ({
  buildMobileCheckoutOrderFingerprint: (params: unknown) =>
    mockBuildMobileCheckoutOrderFingerprint(params),
  clearMobileCheckoutIdempotencyKey: (...params: unknown[]) =>
    mockClearMobileCheckoutIdempotencyKey(...params),
  getMobileCheckoutIdempotencyKey: (...params: unknown[]) =>
    mockGetMobileCheckoutIdempotencyKey(...params),
}));

jest.mock('@/lib/klump-checkout', () => ({
  buildKlumpBnplRouteParams: (params: unknown) =>
    mockBuildKlumpBnplRouteParams(params),
  buildKlumpInitializePayload: (params: unknown) =>
    mockBuildKlumpInitializePayload(params),
  getKlumpDisabledReason: (...params: unknown[]) =>
    mockGetKlumpDisabledReason(...params),
}));

jest.mock('@/services/orders', () => ({
  createOrder: (params: unknown) => mockCreateOrder(params),
  OrderError: class OrderError extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('./checkout-order-builders', () => ({
  buildCheckoutOrderRequest: (params: unknown) =>
    mockBuildCheckoutOrderRequest(params),
}));

jest.mock('./checkout-screen.constants', () => ({
  CHECKOUT_API_BASE_URL: 'https://api.example.com',
  CHECKOUT_MERCHANT_DOMAIN: 'ogabassey.com',
  CHECKOUT_MERCHANT_ID: 'merchant-1',
  CHECKOUT_MERCHANT_SLUG: 'ogabassey',
}));

let submitBnplCheckout: typeof import('./checkout-bnpl-submit')['submitBnplCheckout'];

const address: ShippingAddressInput = {
  address: '15 Marina Road',
  city: 'Lagos',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Customer',
  phone: '08012345678',
  state: 'Lagos',
};

const itemsSnapshot: CartItem[] = [
  {
    id: 'line-1',
    name: 'Ankara Bag',
    price: 20000,
    product_id: 'product-1',
    quantity: 1,
    slug: 'ankara-bag',
  },
];

const snapshot: CheckoutSnapshot = {
  assuranceFee: 0,
  deliveryFee: 1500,
  subtotal: 20000,
  taxAmount: 0,
  total: 21500,
};

function createParams() {
  return {
    address,
    customerEmail: 'ada@example.com',
    customerName: 'Ada Customer',
    customerPhone: '08012345678',
    deliveryMethod: 'door' as const,
    getShippingProvider: () => 'topship',
    isOrderInFlight: { current: true },
    itemsSnapshot,
    liveSavingsSelection: undefined,
    liveWalletSelection: undefined,
    mobileCheckoutIdempotencyRef: { current: null },
    paymentMethodForOrder: 'credit_direct',
    paymentSettings: {},
    selectedPayment: 'credit_direct' as const,
    selectedQuote: { displayName: 'Door delivery', id: 'quote-1', price: 1500 },
    setIsProcessing: jest.fn(),
    snapshot,
  };
}

describe('submitBnplCheckout', () => {
  beforeAll(async () => {
    ({ submitBnplCheckout } = await import('./checkout-bnpl-submit'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildCheckoutOrderRequest.mockReturnValue({
      customer_email: 'ada@example.com',
      customer_name: 'Ada Customer',
      customer_phone: '08012345678',
      items: [{ product_id: 'product-1', quantity: 1 }],
      payment_method: 'credit_direct',
      selected_quote_id: 'quote-1',
      shipping_address: address,
      shipping_fee: 1500,
      shipping_provider: 'topship',
      source: 'mobile_app',
      subtotal: 20000,
      tax_amount: 0,
    });
    mockBuildMobileCheckoutOrderFingerprint.mockReturnValue('fingerprint-1');
    mockGetMobileCheckoutIdempotencyKey.mockReturnValue('idempotency-key-1');
    mockGetKlumpDisabledReason.mockReturnValue(undefined);
    mockCreateOrder.mockResolvedValue({
      amountDueToGateway: 21500,
      order: {
        created_at: '2026-05-30T12:00:00.000Z',
        id: 'order-1',
        order_number: 'BAC-001',
        payment_status: 'pending',
        shipping_status: 'pending',
        total: 21500,
        tracking_token: 'tracking-token',
      },
      savings: null,
      wallet: null,
    });
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('stops Klump checkout and resets state when Klump is unavailable', async () => {
    const params = {
      ...createParams(),
      selectedPayment: 'klump' as const,
      setIsProcessing: jest.fn(),
    };
    mockGetKlumpDisabledReason.mockReturnValue('Amount is below Klump minimum');

    await submitBnplCheckout(params);

    expect(mockAlert).toHaveBeenCalledWith(
      'Klump unavailable',
      'Amount is below Klump minimum',
      [{ text: 'OK' }]
    );
    expect(params.isOrderInFlight.current).toBe(false);
    expect(params.setIsProcessing).toHaveBeenCalledWith(false);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('uses the order service retry identity before routing BNPL', async () => {
    const params = createParams();

    await submitBnplCheckout(params);

    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: 'credit_direct' })
    );
    expect(mockCreateOrder.mock.calls[0][0]).not.toHaveProperty(
      'idempotency_key'
    );
    expect(params.isOrderInFlight.current).toBe(false);
    expect(params.setIsProcessing).toHaveBeenCalledWith(false);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bnpl-checkout',
      params: expect.objectContaining({
        amount: '21500',
        customerEmail: 'ada@example.com',
        gateway: 'credit_direct',
        merchantDomain: 'ogabassey.com',
        merchantSlug: 'ogabassey',
        orderId: 'order-1',
        trackingToken: 'tracking-token',
      }),
    });
  });

  it('preserves the existing checkout identity when the server rejects reuse', async () => {
    const conflict = new Error('not reusable') as Error & { code: string };
    conflict.code = 'CHECKOUT_ORDER_NOT_REUSABLE';
    Object.setPrototypeOf(
      conflict,
      (await import('@/services/orders')).OrderError.prototype
    );
    mockCreateOrder.mockRejectedValueOnce(conflict);

    await expect(submitBnplCheckout(createParams())).rejects.toBe(conflict);

    expect(mockClearMobileCheckoutIdempotencyKey).not.toHaveBeenCalled();
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
  });
});
