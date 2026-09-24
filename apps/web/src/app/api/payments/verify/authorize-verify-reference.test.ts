import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetGuestPaymentReferenceSnapshot = vi.hoisted(() => vi.fn());
vi.mock('./guest-payment-reference-snapshot', () => ({
  getGuestPaymentReferenceSnapshot: (...args: unknown[]) =>
    mockGetGuestPaymentReferenceSnapshot(...args),
}));

const mockGetAuthenticatedUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: (...args: unknown[]) =>
    mockGetAuthenticatedUser(...args),
}));

const mockCreateServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

import { authorizeSessionlessVerifyReference } from './authorize-verify-reference';

const REFERENCE = 'BAC-VERIFY-7';
const TRACKING_TOKEN = 'track-token-7';
const ORDER_ID = 'order-7';

function snapshot() {
  return {
    transactionId: 'txn-7',
    orderId: ORDER_ID,
    merchantId: 'merchant-7',
    amount: 5000,
    currency: 'NGN',
    transactionStatus: 'completed',
    gateway: 'paystack',
    gatewayReference: REFERENCE,
    orderNumber: 'ORD-7',
    orderPaymentStatus: 'paid',
    orderShippingStatus: 'pending',
    orderTotal: 5000,
    inventoryConfirmed: true,
  };
}

function table(result: { data: unknown }) {
  return {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
  };
}

function request() {
  return new Request('https://example.com/api/payments/verify', {
    headers: { authorization: 'Bearer user-token-7' },
    method: 'POST',
  });
}

describe('authorizeSessionlessVerifyReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGuestPaymentReferenceSnapshot.mockResolvedValue(null);
    mockGetAuthenticatedUser.mockResolvedValue(null);
  });

  it('authorizes on the creation tracking token bound to the order', async () => {
    mockGetGuestPaymentReferenceSnapshot.mockResolvedValue(snapshot());
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE, TRACKING_TOKEN)
    ).resolves.toEqual({ authorized: true, orderId: ORDER_ID });
    expect(mockGetAuthenticatedUser).not.toHaveBeenCalled();
  });

  it('denies when the tracking token snapshot misses', async () => {
    mockGetGuestPaymentReferenceSnapshot.mockResolvedValue(null);
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE, TRACKING_TOKEN)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });

  it('denies bearer callers with no validated user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('denies cookie sessions even when a user object exists', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'cookie',
      user: { id: 'user-7' },
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });

  it('authorizes a bearer user whose customer record owns the order', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      user: { id: 'user-7' },
    });
    const from = vi.fn((tableName: string) => {
      if (tableName === 'transactions')
        return table({ data: { order_id: ORDER_ID } });
      if (tableName === 'orders')
        return table({ data: { customer_id: 'cust-7' } });
      return table({ data: { id: 'cust-7' } });
    });
    mockCreateServiceClient.mockReturnValue({ from });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: true, orderId: ORDER_ID });
  });

  it('denies when the reference names no transaction', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      user: { id: 'user-7' },
    });
    mockCreateServiceClient.mockReturnValue({
      from: vi.fn(() => table({ data: null })),
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });

  it('denies when the customer record does not belong to the user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      user: { id: 'user-7' },
    });
    const from = vi.fn((tableName: string) => {
      if (tableName === 'transactions')
        return table({ data: { order_id: ORDER_ID } });
      if (tableName === 'orders')
        return table({ data: { customer_id: 'cust-7' } });
      return table({ data: null });
    });
    mockCreateServiceClient.mockReturnValue({ from });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });

  it('denies when the service read throws', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      user: { id: 'user-7' },
    });
    mockCreateServiceClient.mockImplementation(() => {
      throw new Error('service unavailable');
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });
});
