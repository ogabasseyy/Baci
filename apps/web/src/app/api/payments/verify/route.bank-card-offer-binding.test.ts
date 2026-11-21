import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verificationRouteFixtures } from './route.cancellation.test-support';

const {
  POST,
  createRequest,
  buildSupabase,
  mockCreateServiceClient,
  mockVerifyPaystack,
  getBankCardOfferBinding,
} = verificationRouteFixtures;

describe('Paystack bank-offer route binding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a malformed bank offer reference before looking up a transaction', async () => {
    const response = await POST(createRequest('BCO-invalid'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid reference' });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
  });

  it('returns 503 for a temporary bank-offer binding outage before verification', async () => {
    getBankCardOfferBinding.mockResolvedValueOnce('unavailable');
    const response = await POST(
      createRequest(`BCO-${'a'.repeat(32)}`, 'ogabassey')
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Verification unavailable',
    });
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
    expect(mockVerifyPaystack).not.toHaveBeenCalled();
  });

  it('returns 400 for a browser bank-offer request without a storefront slug', async () => {
    const response = await POST(createRequest(`BCO-${'a'.repeat(32)}`));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant slug is required for bank card offer verification',
    });
    expect(getBankCardOfferBinding).not.toHaveBeenCalled();
    expect(mockCreateServiceClient).not.toHaveBeenCalled();
  });

  it('rejects a bank offer reference bound to a non-Paystack transaction', async () => {
    const supabase = buildSupabase({ completion: null, gateway: 'korapay' });
    mockCreateServiceClient.mockReturnValue(supabase);
    getBankCardOfferBinding.mockResolvedValueOnce({
      orderId: 'order-1',
      merchantId: 'merchant-1',
    });

    const response = await POST(
      createRequest(`BCO-${'a'.repeat(32)}`, 'ogabassey')
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid bank offer capture',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
