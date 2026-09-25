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

describe('initializeGatewayAndRoute', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('routes a card payment after recording the start', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-1',
      authorization_url: 'https://pay.example/authorize',
    });
    const params = createParams();

    await initializeGatewayAndRoute(params);

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', reference: 'ref-1' })
    );
    expect(params.setIsProcessing).toHaveBeenCalledWith(false);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        authorizationUrl: 'https://pay.example/authorize',
        reference: 'ref-1',
      }),
    });
  });

  it('records the full order total when credit partially covers the order', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-1',
      authorization_url: 'https://pay.example/authorize',
    });
    // Wallet credit covered all but 750 of the 5750 order: the provider
    // charges the residual, but started revenue is the full total.
    const partialCreditResponse: OrderResponse = {
      ...orderResponse,
      amountDueToGateway: 750,
      order: { ...orderResponse.order, total: 5750 },
    };

    await initializeGatewayAndRoute(
      createParams({ orderResponse: partialCreditResponse })
    );

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({ value: 5750 })
    );
    // The route still carries what the gateway charges.
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({ amount: '750' }),
    });
  });

  it('forwards the stamped creation currency to the start event', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-1',
      authorization_url: 'https://pay.example/authorize',
    });
    const currencyResponse: OrderResponse = {
      ...orderResponse,
      order: { ...orderResponse.order, currency: 'KES' },
    };

    await initializeGatewayAndRoute(
      createParams({ orderResponse: currencyResponse })
    );

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'KES', value: 5750 })
    );
  });

  it('sends the stamped order currency when initializing payment', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-1',
      authorization_url: 'https://pay.example/authorize',
    });
    const currencyResponse: OrderResponse = {
      ...orderResponse,
      order: { ...orderResponse.order, currency: 'KES' },
    };

    await initializeGatewayAndRoute(
      createParams({ orderResponse: currencyResponse })
    );

    // A hardcoded default trips the server CURRENCY_MISMATCH guard for
    // non-NGN orders, so the stamped currency travels on the request.
    const fetchCalls = (global.fetch as jest.Mock).mock.calls as [
      unknown,
      { body?: unknown },
    ][];
    const requestBody = JSON.parse(
      String(fetchCalls[0]?.[1]?.body ?? '{}')
    ) as Record<string, unknown>;
    expect(requestBody.currency).toBe('KES');
  });

  it('keeps the NGN default when the order carries no currency', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-1',
      authorization_url: 'https://pay.example/authorize',
    });

    await initializeGatewayAndRoute(createParams());

    const fetchCalls = (global.fetch as jest.Mock).mock.calls as [
      unknown,
      { body?: unknown },
    ][];
    const requestBody = JSON.parse(
      String(fetchCalls[0]?.[1]?.body ?? '{}')
    ) as Record<string, unknown>;
    expect(requestBody.currency).toBe('NGN');
  });

  it('stamps each retried start with its issued reference', async () => {
    // A pending order retried: initialize issues a fresh reference per
    // attempt, and each start must carry its own for reconciliation.
    global.fetch = jest
      .fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          reference: 'ref-retry-2',
          authorization_url: 'https://pay.example/authorize-2',
        }),
      }))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          reference: 'ref-retry-1',
          authorization_url: 'https://pay.example/authorize-1',
        }),
      }) as unknown as typeof fetch;

    await initializeGatewayAndRoute(createParams());
    await initializeGatewayAndRoute(createParams());

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(2);
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderId: 'order-1',
        reference: 'ref-retry-1',
      })
    );
    expect(mockTrackCheckoutPaymentStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        orderId: 'order-1',
        reference: 'ref-retry-2',
      })
    );
  });

  it('accepts checkout_url when authorization_url is absent', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-1',
      checkout_url: 'https://pay.example/checkout',
    });

    await initializeGatewayAndRoute(createParams());

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/payment-gateway',
      params: expect.objectContaining({
        authorizationUrl: 'https://pay.example/checkout',
      }),
    });
  });

  it('rejects a success envelope without a reference before emitting the start', async () => {
    mockInitResponse({
      success: true,
      authorization_url: 'https://pay.example/authorize',
    });

    await expect(
      initializeGatewayAndRoute(createParams())
    ).rejects.toMatchObject({
      name: 'OrderError',
      code: 'PAYMENT_INIT_ERROR',
      message: expect.stringContaining('payment reference'),
    });
    expect(mockTrackCheckoutPaymentStarted).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('rejects a card envelope without an authorization URL before emitting the start', async () => {
    mockInitResponse({ success: true, reference: 'ref-1' });

    await expect(
      initializeGatewayAndRoute(createParams())
    ).rejects.toMatchObject({
      name: 'OrderError',
      code: 'PAYMENT_INIT_ERROR',
      message: expect.stringContaining('authorization URL'),
    });
    expect(mockTrackCheckoutPaymentStarted).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('routes a bank transfer with the validated DVA account', async () => {
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
      createParams({ selectedPayment: 'bank_transfer' })
    );

    expect(mockTrackCheckoutPaymentStarted).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        reference: 'ref-dva-1',
        bankName: 'Test Bank',
        accountNumber: '0123456789',
        accountName: 'Ada Buyer',
      }),
    });
  });

  it('accepts the legacy virtual_account envelope for bank transfer', async () => {
    mockInitResponse({
      success: true,
      reference: 'ref-dva-1',
      virtual_account: {
        bank_name: 'Test Bank',
        account_number: '0123456789',
        account_name: 'Ada Buyer',
      },
    });

    await initializeGatewayAndRoute(
      createParams({ selectedPayment: 'bank_transfer' })
    );

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        bankName: 'Test Bank',
        accountNumber: '0123456789',
        accountName: 'Ada Buyer',
      }),
    });
  });

  it.each([
    ['missing account entirely', {}],
    [
      'missing bank name',
      { account_number: '0123456789', account_name: 'Ada' },
    ],
    ['missing account number', { bank_name: 'Test Bank', account_name: 'Ada' }],
    [
      'missing account name',
      { bank_name: 'Test Bank', account_number: '0123456789' },
    ],
    [
      'blank account number',
      { bank_name: 'Test Bank', account_number: '  ', account_name: 'Ada' },
    ],
  ])('rejects a bank-transfer envelope with a %s before emitting the start', async (_label, dva) => {
    mockInitResponse({ success: true, reference: 'ref-dva-1', dva });

    await expect(
      initializeGatewayAndRoute(
        createParams({
          selectedPayment: 'bank_transfer',
        })
      )
    ).rejects.toMatchObject({
      name: 'OrderError',
      code: 'PAYMENT_INIT_ERROR',
      message: expect.stringContaining('virtual account details'),
    });
    expect(mockTrackCheckoutPaymentStarted).not.toHaveBeenCalled();
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
