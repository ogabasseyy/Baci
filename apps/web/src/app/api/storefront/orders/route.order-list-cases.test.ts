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

describe('GET /api/storefront/orders order-list cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats imported paid orders as receipt-ready even when shipping is still processing', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-imported',
                order_number: 'ORD-2001',
                created_at: '2026-03-22T10:00:00.000Z',
                total: 150000,
                subtotal: 140000,
                shipping_fee: 5000,
                tax_amount: 10000,
                discount_amount: 0,
                amount_paid: 150000,
                currency: 'NGN',
                external_source: 'bumpa',
                import_job_id: 'job-1',
                payment_status: 'PAID',
                shipping_status: 'Processing',
                shipping_address: { city: 'Lagos' },
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'imported',
                order_items: [],
              },
            ],
            error: null,
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
    await expect(response.json()).resolves.toEqual({
      orders: [
        expect.objectContaining({
          id: 'order-imported',
          shipping_status: 'processing',
          current_document_kind: 'receipt',
          receipt_eligible: true,
        }),
      ],
    });
  });

  it('files a backdated invoice by its issue date, not its transaction date', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-april',
                order_number: 'ORD-3002',
                created_at: '2026-04-02T10:00:00.000Z',
                transaction_date: '2026-04-02T10:00:00.000Z',
                invoice_issue_date: null,
                total: 95000,
                subtotal: 95000,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 95000,
                currency: 'NGN',
                payment_status: 'paid',
                shipping_status: 'Delivered',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'card',
                order_items: [],
              },
              {
                id: 'order-backdated',
                order_number: 'ORD-3001',
                created_at: '2026-03-05T10:00:00.000Z',
                transaction_date: '2026-03-05T10:00:00.000Z',
                invoice_issue_date: '2026-09-12',
                total: 150000,
                subtotal: 150000,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 150000,
                currency: 'NGN',
                payment_status: 'paid',
                shipping_status: 'Delivered',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'card',
                order_items: [],
              },
            ],
            error: null,
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
    const payload = await response.json();
    // The receipt list renders the September issue date first, so the invoice
    // issued in September must file above the April receipt even though its
    // transaction is older.
    expect(payload.orders.map((order: { id: string }) => order.id)).toEqual([
      'order-backdated',
      'order-april',
    ]);
  });

  it('falls back to joined product images when imported order items have no snapshot image', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-imported',
                order_number: 'ORD-260403-00NN-J',
                created_at: '2026-04-03T10:00:00.000Z',
                total: 1283968.38,
                subtotal: 1283968.38,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 0,
                currency: 'NGN',
                external_source: 'bumpa',
                import_job_id: 'job-1',
                payment_status: 'UNPAID',
                shipping_status: 'Processing',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'imported',
                order_items: [
                  {
                    id: 'item-1',
                    product_id: 'product-1',
                    image_url: null,
                    condition: 'used',
                    variant_name: 'Used',
                    name: 'Samsung Galaxy S26',
                    quantity: 1,
                    price: 1283968.38,
                    has_assurance: false,
                    products: {
                      slug: 'samsung-galaxy-s26',
                      category: 'smartphones',
                      images: [
                        'https://cdn.ogabassey.com/core-assets/products/samsung-galaxy-s25-navy.avif',
                      ],
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
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.orders[0].items[0]).toEqual(
      expect.objectContaining({
        image_url:
          'https://cdn.ogabassey.com/core-assets/products/samsung-galaxy-s25-navy.avif',
        condition: 'used',
        variant_name: 'Used',
        product_images: [
          'https://cdn.ogabassey.com/core-assets/products/samsung-galaxy-s25-navy.avif',
        ],
      })
    );
  });
});
