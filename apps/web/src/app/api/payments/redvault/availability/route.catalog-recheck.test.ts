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

function stubSupabaseShape(shape: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(shape);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { from: vi.fn().mockReturnValue({ select }), maybeSingle, eq };
}

describe('GET /api/payments/redvault/availability catalog recheck', () => {
  beforeEach(() => {
    routeMocks.getRedvaultPaymentAvailability.mockReset();
    routeMocks.authenticateApiRequest.mockReset();
    routeMocks.getRedvaultLivePilotPolicy.mockReset();
  });

  it.each([
    [
      'repriced product',
      {
        price: 150,
        has_variants: false,
        inventory_tracking_policy: 'off',
        status: 'active',
      },
    ],
    [
      'variant-enabled product',
      {
        price: 100,
        has_variants: true,
        inventory_tracking_policy: 'off',
        status: 'active',
      },
    ],
    [
      'newly tracked product',
      {
        price: 100,
        has_variants: false,
        inventory_tracking_policy: 'serialized_strict',
        status: 'active',
      },
    ],
    [
      'budget-brand product',
      {
        price: 100,
        has_variants: false,
        inventory_tracking_policy: 'off',
        brand: 'Infinix',
        name: 'Hot 40',
        status: 'active',
      },
    ],
    [
      'Samsung A-series product',
      {
        price: 100,
        has_variants: false,
        inventory_tracking_policy: 'off',
        brand: 'Samsung',
        name: 'Galaxy A16 5G',
        status: 'active',
      },
    ],
    [
      'draft product',
      {
        price: 100,
        has_variants: false,
        inventory_tracking_policy: 'off',
        brand: 'Apple',
        name: 'iPhone 15',
        status: 'draft',
      },
    ],
    ['missing product row', null],
  ])('hides the pilot for a %s', async (_label, data) => {
    const productId = '11111111-1111-4111-8111-111111111111';
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    routeMocks.getRedvaultLivePilotPolicy.mockReturnValue({
      productId,
      expiresAt: 1_789_000_000_000,
    });
    routeMocks.authenticateApiRequest.mockResolvedValue({
      user: { id: routeMocks.pilotUserId },
      supabase: stubSupabaseShape({ data, error: null }),
    });
    const response = await GET(
      new NextRequest(
        `http://localhost/api/payments/redvault/availability?merchant_id=${OGABASSEY_MERCHANT_ID}&product_id=${productId}`
      )
    );
    await expect(response.json()).resolves.toEqual({
      available: false,
      reason: 'unavailable',
    });
  });
});
