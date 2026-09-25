import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { verifyGatewayPayment } from './verify-gateway-payment';
import { verifyGuestPaymentReference } from './verify-guest-payment-reference';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mockRpc }),
}));

vi.mock('./verify-gateway-payment', () => ({
  getVerifiedAmount: vi.fn(() => null),
  verifyGatewayPayment: vi.fn(),
}));

const flagMocks = vi.hoisted(() => ({
  flag: vi.fn(),
  flagSessionless: vi.fn(),
}));

vi.mock('./flag-guest-payment-provider-confirmed', () => ({
  flagGuestPaymentProviderConfirmed: flagMocks.flag,
}));

vi.mock('./flag-sessionless-payment-provider-confirmed', () => ({
  flagSessionlessPaymentProviderConfirmed: flagMocks.flagSessionless,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const mockedVerifyGatewayPayment = vi.mocked(verifyGatewayPayment);
const mockedLogger = vi.mocked(logger);

function baseSnapshot() {
  return {
    transactionId: 'txn-1',
    orderId: 'order-1',
    merchantId: 'merchant-1',
    amount: 5000,
    currency: 'NGN',
    transactionStatus: 'completed',
    gateway: 'paystack',
    gatewayReference: 'BAC-REF-1',
    orderNumber: 'BAC-001',
    orderPaymentStatus: 'paid',
    orderShippingStatus: null,
    orderTotal: 5000,
    inventoryConfirmed: true,
  };
}

describe('verifyGuestPaymentReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagMocks.flag.mockResolvedValue(true);
    flagMocks.flagSessionless.mockResolvedValue(true);
  });

  it('completes a paid order with the inventory proof', async () => {
    const response = await verifyGuestPaymentReference(baseSnapshot());
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      status: 'success',
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      orderTotal: 5000,
      currency: 'NGN',
      finalizationOutcome: 'completed',
    });
  });

  it('pends a paid order that lacks the inventory proof', async () => {
    const response = await verifyGuestPaymentReference({
      ...baseSnapshot(),
      inventoryConfirmed: false,
    });
    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      status: 'pending',
      orderId: 'order-1',
    });
    expect(mockedVerifyGatewayPayment).not.toHaveBeenCalled();
  });

  it('pends a gateway-confirmed payment awaiting webhook finalization', async () => {
    mockedVerifyGatewayPayment.mockResolvedValue({
      success: true,
      status: 'success',
      gatewayResponse: {},
    } as never);
    const response = await verifyGuestPaymentReference({
      ...baseSnapshot(),
      orderPaymentStatus: 'pending',
    });
    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      status: 'pending',
      orderId: 'order-1',
    });
  });

  it('flags a gateway-confirmed payment for the wedge sweep', async () => {
    mockedVerifyGatewayPayment.mockResolvedValue({
      success: true,
      status: 'success',
      gatewayResponse: {},
    } as never);
    const response = await verifyGuestPaymentReference(
      {
        ...baseSnapshot(),
        orderPaymentStatus: 'pending',
      },
      { trackingToken: 'tok-1' }
    );
    const body = await response.json();

    expect(body).toMatchObject({ success: false, status: 'pending' });
    expect(flagMocks.flag).toHaveBeenCalledWith(
      'order-1',
      'tok-1',
      'BAC-REF-1'
    );
  });

  it('skips the sweep flag without a tracking token', async () => {
    mockedVerifyGatewayPayment.mockResolvedValue({
      success: true,
      status: 'success',
      gatewayResponse: {},
    } as never);
    const response = await verifyGuestPaymentReference({
      ...baseSnapshot(),
      orderPaymentStatus: 'pending',
    });
    const body = await response.json();

    expect(body).toMatchObject({ success: false, status: 'pending' });
    expect(flagMocks.flag).not.toHaveBeenCalled();
    expect(flagMocks.flagSessionless).not.toHaveBeenCalled();
  });

  it('flags through the sessionless RPC for a bearer caller without a token', async () => {
    mockedVerifyGatewayPayment.mockResolvedValue({
      success: true,
      status: 'success',
      gatewayResponse: {},
    } as never);
    const sessionlessClient = { rpc: vi.fn() };
    const response = await verifyGuestPaymentReference(
      {
        ...baseSnapshot(),
        orderPaymentStatus: 'pending',
      },
      { sessionlessClient: sessionlessClient as never }
    );
    const body = await response.json();

    expect(body).toMatchObject({ success: false, status: 'pending' });
    expect(flagMocks.flagSessionless).toHaveBeenCalledWith(
      sessionlessClient,
      'BAC-REF-1'
    );
    expect(flagMocks.flag).not.toHaveBeenCalled();
  });

  it('stays pending when the sweep flag fails', async () => {
    mockedVerifyGatewayPayment.mockResolvedValue({
      success: true,
      status: 'success',
      gatewayResponse: {},
    } as never);
    flagMocks.flag.mockResolvedValue(false);
    const response = await verifyGuestPaymentReference(
      {
        ...baseSnapshot(),
        orderPaymentStatus: 'pending',
      },
      { trackingToken: 'tok-1' }
    );
    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      status: 'pending',
      orderId: 'order-1',
    });
  });

  it('rejects a failed provider verification with a 400', async () => {
    mockedVerifyGatewayPayment.mockResolvedValue({
      success: false,
      error: 'REF not found',
      code: 'NOT_FOUND',
    } as never);
    const response = await verifyGuestPaymentReference({
      ...baseSnapshot(),
      orderPaymentStatus: 'pending',
    });

    expect(response.status).toBe(400);
    expect(mockedLogger.warn).toHaveBeenCalled();
  });
});
