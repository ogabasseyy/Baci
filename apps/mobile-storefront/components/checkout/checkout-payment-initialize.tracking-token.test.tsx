import { jest } from '@jest/globals';
import { router } from 'expo-router';
import { trackCheckoutPaymentStarted } from '@/services/analytics';
import type { OrderResponse } from '@/services/orders';
import {
  type InitializeGatewayAndRouteParams,
  initializeGatewayAndRoute,
} from './checkout-payment-initialize';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@/services/analytics', () => ({
  trackCheckoutPaymentStarted: jest.fn(),
}));

jest.mock('@/services/orders', () => ({
  OrderError: class extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.name = 'OrderError';
      this.code = code;
    }
  },
}));

const mockRouterPush = router.push as jest.Mock;
const mockTrackCheckoutPaymentStarted =
  trackCheckoutPaymentStarted as jest.Mock;

const orderResponse: OrderResponse = {
  amountDueToGateway: 5750,
  order: {
    created_at: '2026-09-20T12:00:00.000Z',
    id: 'order-1',
    order_number: 'ORD-1',
    payment_status: 'pending',
    shipping_status: 'pending',
    total: 5750,
  },
  wallet: null,
};

function createParams(
  overrides: Partial<InitializeGatewayAndRouteParams> = {}
): InitializeGatewayAndRouteParams {
  return {
    customerEmail: 'ada@example.com',
    customerName: 'Ada Buyer',
    customerPhone: '+2348123456789',
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    orderResponse,
    selectedPayment: 'paystack',
    setIsProcessing: jest.fn(),
    trackingToken: null,
    ...overrides,
  };
}

function mockInitResponse(payload: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

function getLastRequestBody(): Record<string, unknown> {
  const fetchCalls = (global.fetch as jest.Mock).mock.calls as [
    unknown,
    { body?: unknown },
  ][];
  return JSON.parse(String(fetchCalls[0]?.[1]?.body ?? '{}')) as Record<
    string,
    unknown
  >;
}

describe('initializeGatewayAndRoute tracking token handling', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards the tracking token to DVA initialization and bank-transfer params', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-dva-1',
      dva: {
        bank_name: 'Test Bank',
        account_number: '0123456789',
        account_name: 'Ada Buyer',
      },
    });

    await initializeGatewayAndRoute(
      createParams({
        selectedPayment: 'bank_transfer',
        trackingToken: 'track-order-1',
      })
    );

    expect(getLastRequestBody().tracking_token).toBe('track-order-1');
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        reference: 'ref-dva-1',
        trackingToken: 'track-order-1',
      }),
    });
  });

  it('omits whitespace-only DVA tracking tokens without trimming opaque tokens', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-dva-blank-token',
      dva: {
        bank_name: 'Test Bank',
        account_number: '0123456789',
        account_name: 'Ada Buyer',
      },
    });

    await initializeGatewayAndRoute(
      createParams({
        selectedPayment: 'bank_transfer',
        trackingToken: '  \t  ',
      })
    );

    expect(getLastRequestBody()).not.toHaveProperty('tracking_token');
    const pushedParams = (
      mockRouterPush.mock.calls[0]?.[0] as { params?: Record<string, unknown> }
    )?.params;
    expect(pushedParams).not.toHaveProperty('trackingToken');
  });

  it('preserves nonblank DVA tracking token bytes', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-dva-opaque-token',
      dva: {
        bank_name: 'Test Bank',
        account_number: '0123456789',
        account_name: 'Ada Buyer',
      },
    });

    const opaqueToken = ' token-with-space ';
    await initializeGatewayAndRoute(
      createParams({
        selectedPayment: 'bank_transfer',
        trackingToken: opaqueToken,
      })
    );

    expect(getLastRequestBody().tracking_token).toBe(opaqueToken);
  });

  it('omits tracking_token on card initialization even when a tracking token is present', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-card-token',
      authorization_url: 'https://pay.example/authorize',
    });

    await initializeGatewayAndRoute(
      createParams({
        selectedPayment: 'paystack',
        trackingToken: 'opaque-card-tracking-token',
      })
    );

    const requestBody = getLastRequestBody();
    expect(requestBody.gateway).toBe('paystack');
    expect(requestBody.tracking_token).toBeUndefined();
    const pushedParams = (
      mockRouterPush.mock.calls[0]?.[0] as { params?: Record<string, unknown> }
    )?.params;
    expect(pushedParams?.trackingToken).toBe('opaque-card-tracking-token');
  });
});
