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

  it('returns 401 when the customer is not authenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when merchantSlug is missing', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(createSupabaseMock())
    );

    const response = await GET(
      new NextRequest('http://localhost/api/storefront/orders')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request',
      details: expect.any(Object),
    });
  });

  it('returns 400 when merchantSlug is invalid', async () => {
    const supabase = createSupabaseMock();
    const authResult = createAuthenticatedAuthResult(supabase);
    vi.mocked(authenticateApiRequest).mockResolvedValue(authResult);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=bad slug'
      )
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request',
      details: expect.any(Object),
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 404 when the merchant cannot be found', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          merchant: {
            data: null,
            error: { message: 'not found' },
          },
        })
      )
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Store not found',
    });
  });

  it('returns an empty order list when the customer has no merchant record yet', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          customer: {
            data: null,
            error: { message: 'not found' },
          },
        })
      )
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ orders: [] });
  });

  it('returns transformed customer orders with document metadata', async () => {
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
                subtotal: 140000,
                shipping_fee: 5000,
                tax_amount: 10000,
                discount_amount: 0,
                amount_paid: 150000,
                currency: 'NGN',
                external_source: null,
                import_job_id: null,
                payment_status: 'PAID',
                shipping_status: 'Delivered',
                shipping_address: { city: 'Lagos' },
                tracking_number: 'TRACK-1',
                shipping_provider: 'GIGL',
                payment_method: 'card',
                fulfillment_details: {
                  imei: '353456789012345',
                  serialNumber: 'SN-123',
                },
                order_items: [
                  {
                    id: 'item-1',
                    product_id: 'product-1',
                    name: 'Imported Product',
                    condition: 'used',
                    variant_name: 'Used',
                    quantity: 2,
                    price: 70000,
                    has_assurance: false,
                    products: {
                      slug: 'imported-product',
                      category: 'smartphones',
                      categories: [
                        { name: 'Smartphones', slug: 'smartphones' },
                      ],
                    },
                  },
                ],
              },
            ],
            error: null,
          },
        })
      )
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogaBassey'
      )
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orders: [
        {
          id: 'order-1',
          order_number: 'ORD-1001',
          created_at: '2026-03-22T10:00:00.000Z',
          total: 150000,
          subtotal: 140000,
          shipping_fee: 5000,
          tax_amount: 10000,
          discount_amount: 0,
          amount_paid: 150000,
          currency: 'NGN',
          payment_status: 'paid',
          shipping_status: 'delivered',
          shipping_address: { city: 'Lagos' },
          tracking_number: 'TRACK-1',
          shipping_provider: 'GIGL',
          payment_method: 'card',
          virtual_account: null,
          balance: 0,
          current_document_kind: 'receipt',
          invoice_type_code: '380',
          receipt_eligible: true,
          items: [
            {
              id: 'item-1',
              product_id: 'product-1',
              name: 'Imported Product',
              condition: 'used',
              variant_name: 'Used',
              quantity: 2,
              price: 70000,
              has_assurance: false,
              product_slug: 'imported-product',
              category: 'smartphones',
              category_slug: 'smartphones',
              categories: { name: 'Smartphones', slug: 'smartphones' },
            },
          ],
        },
      ],
    });
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
