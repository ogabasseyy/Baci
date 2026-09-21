const mockAlert = jest.fn();
const mockCreateWalletFundedBankTransferIntent = jest.fn();
const mockRouterPush = jest.fn();
const mockTrackError = jest.fn();

jest.mock('react-native', () => {
  return {
    Alert: {
      alert: mockAlert,
    },
  };
});

jest.mock('@/lib/checkout/wallet-funded-bank-transfer', () => ({
  createWalletFundedBankTransferIntent: (
    params: Parameters<typeof mockCreateWalletFundedBankTransferIntent>[0]
  ) => mockCreateWalletFundedBankTransferIntent(params),
}));

jest.mock('expo-router', () => ({
  router: {
    push: mockRouterPush,
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'https://api.example.com',
        merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        merchantSlug: 'ogabassey',
      },
    },
  },
}));

jest.mock('@/services/analytics', () => ({
  trackError: mockTrackError,
}));

let startWalletFundedBankTransferCheckout: typeof import('./checkout-wallet-funded-bank-transfer')['startWalletFundedBankTransferCheckout'];

const createFundingResponse = () => ({
  account: {
    accountName: 'Ada Lovelace',
    accountNumber: '1234567890',
    bankName: 'Paystack Bank',
    provider: 'paystack',
  },
  intent: {
    currency: 'NGN',
    expectedAmount: 470000,
    expiresAt: '2026-05-30T12:00:00.000Z',
    fundedAmount: 0,
    id: '11111111-1111-4111-8111-111111111111',
    orderId: '22222222-2222-4222-8222-222222222222',
    status: 'pending',
    targetOrderAmount: 470000,
  },
});

describe('startWalletFundedBankTransferCheckout', () => {
  beforeAll(async () => {
    ({ startWalletFundedBankTransferCheckout } = await import(
      './checkout-wallet-funded-bank-transfer'
    ));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes to wallet-funded bank transfer when intent creation succeeds', async () => {
    mockCreateWalletFundedBankTransferIntent.mockImplementation(
      async ({ onSuccess }) => {
        const response = createFundingResponse();
        onSuccess(response);
        return response;
      }
    );
    const isOrderInFlight = { current: true };
    const setIsProcessing = jest.fn();

    const started = await startWalletFundedBankTransferCheckout({
      isOrderInFlight,
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderTotal: 470000,
      setIsProcessing,
      trackingToken: 'tracking-token',
    });

    expect(started).toBe('11111111-1111-4111-8111-111111111111');
    expect(isOrderInFlight.current).toBe(false);
    expect(setIsProcessing).toHaveBeenCalledWith(false);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        accountName: 'Ada Lovelace',
        accountNumber: '1234567890',
        amount: '470000',
        bankName: 'Paystack Bank',
        intentId: '11111111-1111-4111-8111-111111111111',
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        orderTotal: '470000',
        trackingToken: 'tracking-token',
        walletFunded: 'true',
      }),
    });
  });

  it('carries the checkout attribution snapshot onto the bank-transfer route', async () => {
    mockCreateWalletFundedBankTransferIntent.mockImplementation(
      async ({ onSuccess }) => {
        const response = createFundingResponse();
        onSuccess(response);
        return response;
      }
    );

    await startWalletFundedBankTransferCheckout({
      attribution: {
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        subtotal: 450000,
        shipping: 15000,
        tax: 5000,
      },
      isOrderInFlight: { current: true },
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderTotal: 470000,
      setIsProcessing: jest.fn(),
      trackingToken: 'tracking-token',
    });

    // The wallet-funded completion wins the durable claim after the cart
    // may clear: identity and breakdown must travel on the route since the
    // success screen cannot enrich the claim afterwards.
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/bank-transfer',
      params: expect.objectContaining({
        orderId: 'order-1',
        customerEmail: 'guest@example.com',
        customerPhone: '+2348123456789',
        subtotal: '450000',
        shipping: '15000',
        tax: '5000',
      }),
    });
  });

  it('alerts and tracks fallback when wallet intent creation cannot start', async () => {
    mockCreateWalletFundedBankTransferIntent.mockImplementation(
      async ({ onFallback }) => {
        onFallback({
          code: 'WALLET_DVA_SETUP_FAILED',
          consent: true,
          error: new Error('Paystack unavailable'),
          message: 'Paystack unavailable',
        });
        return null;
      }
    );

    const started = await startWalletFundedBankTransferCheckout({
      isOrderInFlight: { current: true },
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderTotal: 470000,
      setIsProcessing: jest.fn(),
    });

    expect(started).toBeNull();
    expect(mockTrackError).toHaveBeenCalledWith(
      'wallet_order_funding_intent_failed',
      'Paystack unavailable',
      {
        code: 'WALLET_DVA_SETUP_FAILED',
        consent: true,
        orderId: 'order-1',
      }
    );
    expect(mockAlert).toHaveBeenCalledWith(
      'Bank transfer unavailable',
      expect.stringContaining('standard bank transfer'),
      [{ text: 'OK' }]
    );
  });

  it('passes a consent prompt callback that resolves to true immediately', async () => {
    mockCreateWalletFundedBankTransferIntent.mockImplementation(
      async ({ requestConsent }) => {
        const consent = await requestConsent();
        return consent ? createFundingResponse() : null;
      }
    );

    const started = await startWalletFundedBankTransferCheckout({
      isOrderInFlight: { current: true },
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderTotal: 470000,
      setIsProcessing: jest.fn(),
    });

    expect(started).toBe('11111111-1111-4111-8111-111111111111');
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
