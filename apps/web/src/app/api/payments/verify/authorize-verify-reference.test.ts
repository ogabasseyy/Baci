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

function bearerClient(rpc: ReturnType<typeof vi.fn>) {
  return { rpc };
}

function request() {
  return new Request('https://example.com/api/payments/verify', {
    headers: { authorization: 'Bearer [REDACTED]' },
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

  it('denies Bearer [REDACTED] with no validated user', async () => {
    mockGetAuthenticatedUser.mockResolvedValue(null);
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
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

  it('authorizes a Bearer [REDACTED] whose customer record owns the order', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ORDER_ID, error: null });
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      supabase: bearerClient(rpc),
      user: { id: 'user-7' },
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: true, orderId: ORDER_ID });
    expect(rpc).toHaveBeenCalledWith('authorize_sessionless_verify_reference', {
      p_gateway_reference: REFERENCE,
    });
  });

  it('denies when the RPC returns no order', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      supabase: bearerClient(rpc),
      user: { id: 'user-7' },
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });

  it('denies when the RPC errors', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'denied' } });
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      supabase: bearerClient(rpc),
      user: { id: 'user-7' },
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });

  it('denies when the bearer client throws', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('unavailable'));
    mockGetAuthenticatedUser.mockResolvedValue({
      authMode: 'bearer',
      supabase: bearerClient(rpc),
      user: { id: 'user-7' },
    });
    await expect(
      authorizeSessionlessVerifyReference(request(), REFERENCE)
    ).resolves.toEqual({ authorized: false, orderId: null });
  });
});
