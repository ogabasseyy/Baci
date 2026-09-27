import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  getRedvaultPaymentAvailability: vi.fn(),
}));

vi.mock('@/lib/checkout/redvault-payment-availability', () => ({
  getRedvaultPaymentAvailability: routeMocks.getRedvaultPaymentAvailability,
}));

import { GET } from './route';

const OGABASSEY_MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('GET /api/payments/redvault/availability', () => {
  beforeEach(() => {
    routeMocks.getRedvaultPaymentAvailability.mockReset();
  });

  it('returns the server availability for the immutable Ogabassey merchant', async () => {
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: false,
      reason: 'provider_evidence_unavailable',
    });

    const response = GET(
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
    const response = GET(
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
    const response = GET(
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
});
