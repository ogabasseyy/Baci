import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { GET } from './route';
import {
  createAuthenticatedAuthResult,
  createSupabaseMock,
} from './route.test-support';

describe('GET /api/storefront/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 500 when the orders query fails', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: null,
            error: { message: 'boom' },
          },
        })
      )
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch orders',
    });
  });

  it('returns 500 when order transactions cannot be loaded', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-1',
                order_number: 'ORD-1001',
                created_at: '2026-03-22T10:00:00.000Z',
                total: 150000,
                subtotal: 150000,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 150000,
                currency: 'NGN',
                payment_status: 'paid',
                shipping_status: 'Pending',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'paystack',
                order_items: [],
              },
            ],
            error: null,
          },
          transactions: {
            data: null,
            error: { message: 'transaction RPC unavailable' },
          },
        })
      )
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch order transactions',
    });
  });

  it('returns 500 when payment accounts cannot be loaded', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-1',
                order_number: 'ORD-1001',
                created_at: '2026-03-22T10:00:00.000Z',
                total: 150000,
                subtotal: 150000,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 0,
                currency: 'NGN',
                payment_status: 'UNPAID',
                shipping_status: 'Pending',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'paystack',
                order_items: [],
              },
            ],
            error: null,
          },
          paymentAccounts: {
            data: null,
            error: { message: 'payment account RPC unavailable' },
          },
        })
      )
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch payment accounts',
    });
  });
});
