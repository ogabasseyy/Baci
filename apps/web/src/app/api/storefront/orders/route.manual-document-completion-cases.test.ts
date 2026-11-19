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

describe('GET /api/storefront/orders manual completion cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the completing payment date for a settled manual balance', async () => {
    const supabase = createSupabaseMock({
      orders: {
        data: [
          {
            id: 'manual-order',
            order_number: 'MANUAL-1',
            created_at: '2026-09-20T09:00:00Z',
            transaction_date: '2026-09-25T09:00:00Z',
            total: 100,
            subtotal: 100,
            shipping_fee: 0,
            tax_amount: 0,
            discount_amount: 0,
            amount_paid: 100,
            currency: 'NGN',
            payment_status: 'partially_paid',
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
            order_id: 'manual-order',
            amount: 100,
            created_at: '2026-09-30T12:00:00Z',
            metadata: null,
            status: 'completed',
            transaction_type: 'payment',
          },
        ],
        error: null,
      },
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(supabase)
    );
    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/orders?merchantSlug=ogabassey'
      )
    );
    const data = await response.json();
    // The non-paid label still loads transactions: the balance is settled
    // in substance, so the preview needs the completing payment date.
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith(
      'get_customer_order_transactions',
      { p_order_ids: ['manual-order'] }
    );
    expect(data.orders[0]).toMatchObject({
      current_document_kind: 'receipt',
      receipt_completion_date: '2026-09-30T12:00:00Z',
    });
  });
});
