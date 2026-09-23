import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { verifyGatewayPayment } from './verify-gateway-payment';
import {
  getGuestPaymentReferenceSnapshot,
  verifyGuestPaymentReference,
} from './verify-guest-payment-reference';

const mockRpc = vi.fn();
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ rpc: mockRpc }),
}));

vi.mock('./verify-gateway-payment', () => ({
  getVerifiedAmount: vi.fn(() => null),
  verifyGatewayPayment: vi.fn(),
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

describe('getGuestPaymentReferenceSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps a well-formed snapshot row', async () => {
    mockRpc.mockResolvedValue({
      error: null,
      data: [
        {
          transaction_id: 'txn-1',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          gateway_reference: 'BAC-REF-1',
          amount: 5000,
          currency: 'NGN',
          transaction_status: 'completed',
          gateway: 'paystack',
          order_number: 'BAC-001',
          order_payment_status: 'paid',
          order_total: 5000,
          inventory_confirmed: true,
        },
      ],
    });

    const snapshot = await getGuestPaymentReferenceSnapshot(
      'BAC-REF-1',
      'tok-1'
    );

    expect(snapshot).toMatchObject({
      transactionId: 'txn-1',
      orderId: 'order-1',
      inventoryConfirmed: true,
    });
  });

  it('fails closed on errors, empty rows, and malformed rows', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'db down' }, data: null });
    await expect(
      getGuestPaymentReferenceSnapshot('BAC-REF-1', 'tok-1')
    ).resolves.toBeNull();

    mockRpc.mockResolvedValue({ error: null, data: [] });
    await expect(
      getGuestPaymentReferenceSnapshot('BAC-REF-1', 'tok-1')
    ).resolves.toBeNull();

    mockRpc.mockResolvedValue({
      error: null,
      data: [{ order_id: 'order-1' }],
    });
    await expect(
      getGuestPaymentReferenceSnapshot('BAC-REF-1', 'tok-1')
    ).resolves.toBeNull();
  });
});

describe('verifyGuestPaymentReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
