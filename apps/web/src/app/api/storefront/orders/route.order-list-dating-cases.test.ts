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

describe('GET /api/storefront/orders completion-date filing cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files a covered receipt by its completion date, not its issue date', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-september-invoice',
                order_number: 'ORD-3003',
                created_at: '2026-09-12T10:00:00.000Z',
                transaction_date: '2026-09-12T10:00:00.000Z',
                invoice_issue_date: '2026-09-12',
                total: 150000,
                subtotal: 150000,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 0,
                currency: 'NGN',
                payment_status: 'unpaid',
                shipping_status: 'Delivered',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'card',
                order_items: [],
              },
              {
                id: 'order-covered-manual',
                order_number: 'MANUAL-3004',
                created_at: '2026-01-10T10:00:00.000Z',
                transaction_date: '2026-01-10T10:00:00.000Z',
                invoice_issue_date: '2026-01-10',
                total: 100,
                subtotal: 100,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 100,
                currency: 'NGN',
                payment_status: 'pending',
                shipping_status: 'pending',
                recorded_by_user_id: 'staff-1',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'bank_transfer',
                order_items: [
                  {
                    id: 'item-1',
                    product_id: 'product-1',
                    name: 'Device',
                    quantity: 1,
                    price: 100,
                    has_assurance: false,
                  },
                ],
              },
            ],
            error: null,
          },
          transactions: {
            data: [
              {
                order_id: 'order-covered-manual',
                created_at: '2026-10-05T12:00:00.000Z',
                metadata: null,
                status: 'completed',
                transaction_type: 'payment',
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
    // The card displays the October completion date, so the January-issued
    // receipt must file above the September invoice.
    expect(payload.orders.map((order: { id: string }) => order.id)).toEqual([
      'order-covered-manual',
      'order-september-invoice',
    ]);
    expect(payload.orders[0]).toMatchObject({
      current_document_kind: 'receipt',
      receipt_completion_date: '2026-10-05T12:00:00.000Z',
      transaction_date: '2026-10-05T12:00:00.000Z',
    });
    expect(payload.orders[0]).not.toHaveProperty('invoice_issue_date');
  });
});
