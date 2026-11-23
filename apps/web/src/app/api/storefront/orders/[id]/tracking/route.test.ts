import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  customerMaybeSingle: vi.fn(),
  orderMaybeSingle: vi.fn(),
  orderEq: vi.fn(),
  resolveMerchantIdBySlug: vi.fn(),
  trackShipment: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: mocks.customerMaybeSingle,
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn((...firstArgs: unknown[]) => {
            mocks.orderEq(...firstArgs);
            return {
              eq: vi.fn((...secondArgs: unknown[]) => {
                mocks.orderEq(...secondArgs);
                return {
                  eq: vi.fn((...thirdArgs: unknown[]) => {
                    mocks.orderEq(...thirdArgs);
                    return {
                      maybeSingle: mocks.orderMaybeSingle,
                    };
                  }),
                };
              }),
            };
          }),
        })),
      };
    }),
  })),
}));

vi.mock('../resolve-merchant-id-by-slug', () => ({
  resolveMerchantIdBySlug: mocks.resolveMerchantIdBySlug,
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    trackShipment: mocks.trackShipment,
  },
}));

import { GET } from './route';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

describe('GET /api/storefront/orders/[id]/tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'ada@example.com' } },
      error: null,
    });
    mocks.resolveMerchantIdBySlug.mockResolvedValue(MERCHANT_ID);
    mocks.customerMaybeSingle.mockResolvedValue({
      data: { id: CUSTOMER_ID },
      error: null,
    });
  });

  it('returns 401 when the shopper is not signed in', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking?merchantSlug=savings-synthetic`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(401);
  });

  it('returns 400 for an invalid order UUID', async () => {
    const res = await GET(
      new NextRequest(
        'https://localhost/api/storefront/orders/bad-id/tracking?merchantSlug=savings-synthetic'
      ),
      { params: Promise.resolve({ id: 'bad-id' }) }
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 when merchantSlug is omitted', async () => {
    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(400);
    expect(mocks.trackShipment).not.toHaveBeenCalled();
  });

  it('returns 404 when the signed-in shopper has no customer record for the merchant', async () => {
    mocks.customerMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking?merchantSlug=savings-synthetic`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(404);
    expect(mocks.orderMaybeSingle).not.toHaveBeenCalled();
    expect(mocks.trackShipment).not.toHaveBeenCalled();
  });

  it('returns 404 when the order does not belong to the signed-in customer', async () => {
    mocks.orderMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking?merchantSlug=savings-synthetic`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(404);
    expect(mocks.orderEq).toHaveBeenCalledWith('id', ORDER_ID);
    expect(mocks.orderEq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
    expect(mocks.orderEq).toHaveBeenCalledWith('customer_id', CUSTOMER_ID);
    expect(mocks.trackShipment).not.toHaveBeenCalled();
  });

  it('disables tracking when the order has not been shipped yet', async () => {
    mocks.orderMaybeSingle.mockResolvedValue({
      data: {
        id: ORDER_ID,
        merchant_id: MERCHANT_ID,
        order_number: 'ORD-001',
        shipping_status: 'processing',
        shipping_provider: 'GIGL',
        tracking_number: 'GIG-12345',
      },
      error: null,
    });

    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking?merchantSlug=savings-synthetic`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trackingAvailable: false,
      reason: 'Tracking is available once your order has been shipped.',
    });
    expect(mocks.trackShipment).not.toHaveBeenCalled();
  });

  it('returns live GIGL tracking events once the order is shipped', async () => {
    mocks.orderMaybeSingle.mockResolvedValue({
      data: {
        id: ORDER_ID,
        merchant_id: MERCHANT_ID,
        order_number: 'ORD-002',
        shipping_status: 'shipped',
        shipping_provider: 'GIGL',
        tracking_number: 'GIG-987654',
      },
      error: null,
    });
    mocks.trackShipment.mockResolvedValue({
      provider: 'GIGL',
      carrierName: 'GIG Logistics',
      trackingNumber: 'GIG-987654',
      status: 'in_transit',
      estimatedDelivery: new Date('2026-11-23T15:00:00.000Z'),
      events: [
        {
          status: 'In Transit',
          description: 'Arrived at Lekki Hub',
          location: 'Lekki, Lagos',
          timestamp: new Date('2026-11-22T12:00:00.000Z'),
        },
      ],
    });

    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking?merchantSlug=savings-synthetic`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(200);
    expect(mocks.trackShipment).toHaveBeenCalledWith('GIG-987654', 'GIGL');
    expect(await res.json()).toEqual({
      trackingAvailable: true,
      tracking: {
        provider: 'GIGL',
        carrierName: 'GIG Logistics',
        trackingNumber: 'GIG-987654',
        status: 'in_transit',
        statusLabel: 'In Transit',
        estimatedDelivery: '2026-11-23T15:00:00.000Z',
        actualDelivery: null,
        events: [
          {
            status: 'In Transit',
            description: 'Arrived at Lekki Hub',
            location: 'Lekki, Lagos',
            timestamp: '2026-11-22T12:00:00.000Z',
          },
        ],
        liveUnavailable: false,
      },
    });
  });

  it('falls back gracefully when live GIGL tracking fails', async () => {
    mocks.orderMaybeSingle.mockResolvedValue({
      data: {
        id: ORDER_ID,
        merchant_id: MERCHANT_ID,
        order_number: 'ORD-003',
        shipping_status: 'shipped',
        shipping_provider: 'GIGL',
        tracking_number: 'GIG-987654',
      },
      error: null,
    });
    mocks.trackShipment.mockRejectedValue(new Error('GIGL timeout'));

    const res = await GET(
      new NextRequest(
        `https://localhost/api/storefront/orders/${ORDER_ID}/tracking?merchantSlug=savings-synthetic`
      ),
      { params: Promise.resolve({ id: ORDER_ID }) }
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      trackingAvailable: true,
      tracking: {
        provider: 'GIGL',
        carrierName: 'GIG Logistics',
        trackingNumber: 'GIG-987654',
        statusLabel: 'Shipped',
        liveUnavailable: true,
      },
    });
  });
});
