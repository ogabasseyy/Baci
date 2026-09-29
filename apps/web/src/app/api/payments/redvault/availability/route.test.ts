import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  getRedvaultPaymentAvailability: vi.fn(),
  authenticateApiRequest: vi.fn(),
  getRedvaultLivePilotPolicy: vi.fn(),
  pilotUserId: '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
}));

vi.mock('@/lib/checkout/redvault-payment-availability', () => ({
  getRedvaultPaymentAvailability: routeMocks.getRedvaultPaymentAvailability,
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: routeMocks.authenticateApiRequest,
}));
vi.mock('@/lib/checkout/redvault-live-pilot', () => ({
  getRedvaultLivePilotPolicy: routeMocks.getRedvaultLivePilotPolicy,
  REDVAULT_PILOT_USER_ID: routeMocks.pilotUserId,
}));

import { GET } from './route';

const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('GET /api/payments/redvault/availability', () => {
  beforeEach(() => {
    routeMocks.getRedvaultPaymentAvailability.mockReset();
    routeMocks.authenticateApiRequest.mockReset();
    routeMocks.getRedvaultLivePilotPolicy.mockReset();
  });

  it('returns the server availability for the immutable Ogabassey merchant', async () => {
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: false,
      reason: 'provider_evidence_unavailable',
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}`
      )
    );

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: 'provider_evidence_unavailable',
    });
  });

  it('returns a non-sensitive false result for another valid merchant', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/payments/redvault/availability?merchant_id=11111111-1111-4111-8111-111111111111'
      )
    );

    expect(routeMocks.getRedvaultPaymentAvailability).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: 'merchant_unavailable',
    });
  });

  it('rejects an invalid merchant identifier without querying private state', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/payments/redvault/availability?merchant_id=not-a-uuid'
      )
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(routeMocks.getRedvaultPaymentAvailability).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: 'invalid_merchant_id',
    });
  });

  it('allows the authenticated pilot user for the configured product', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    routeMocks.getRedvaultLivePilotPolicy.mockReturnValue({ productId });
    routeMocks.authenticateApiRequest.mockResolvedValue({
      user: { id: routeMocks.pilotUserId },
    });
    const response = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}&product_id=${productId}`
      )
    );
    await expect(response.json()).resolves.toEqual({
      available: true,
      reason: 'private_live_pilot',
    });
  });

  it('hides the pilot from guests and for a mismatched product', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    routeMocks.getRedvaultLivePilotPolicy.mockReturnValue({ productId });
    routeMocks.authenticateApiRequest.mockResolvedValue({ user: null });
    const guestResponse = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}&product_id=${productId}`
      )
    );
    await expect(guestResponse.json()).resolves.toEqual({
      available: false,
      reason: 'unavailable',
    });
    expect(routeMocks.authenticateApiRequest).toHaveBeenCalledTimes(1);

    routeMocks.authenticateApiRequest.mockResolvedValue({
      user: { id: 'other-user' },
    });
    const wrongUserResponse = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}&product_id=${productId}`
      )
    );
    await expect(wrongUserResponse.json()).resolves.toEqual({
      available: false,
      reason: 'unavailable',
    });
    expect(routeMocks.authenticateApiRequest).toHaveBeenCalledTimes(2);

    const wrongProductResponse = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}&product_id=22222222-2222-4222-8222-222222222222`
      )
    );
    await expect(wrongProductResponse.json()).resolves.toEqual({
      available: false,
      reason: 'unavailable',
    });
    expect(routeMocks.authenticateApiRequest).toHaveBeenCalledTimes(2);
  });

  it('hides the pilot when the product query is absent', async () => {
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    routeMocks.getRedvaultLivePilotPolicy.mockReturnValue({
      productId: '11111111-1111-4111-8111-111111111111',
    });
    const response = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}`
      )
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: 'unavailable',
    });
    expect(routeMocks.authenticateApiRequest).not.toHaveBeenCalled();
  });
});
