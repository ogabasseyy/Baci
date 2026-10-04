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

describe('GET /api/storefront/orders manual document tax cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('withholds documents whose RPC-loaded tax the sender rejects', async () => {
    // The tax table is merchant-readable: the embedded relation returns []
    // under customer RLS, so the route loads the ownership-checked RPC
    // projection — a negative subtotal must hide the document here exactly
    // as tax_breakdown_invalid skips it in the email sender.
    const supabase = createSupabaseMock({
      orders: {
        data: [
          {
            id: 'manual-invoice',
            order_number: 'MANUAL-TAX-1',
            created_at: '2026-09-20T09:00:00Z',
            transaction_date: '2026-09-25T09:00:00Z',
            total: 100,
            subtotal: 100,
            shipping_fee: 0,
            tax_amount: 0,
            discount_amount: 0,
            amount_paid: 0,
            currency: 'NGN',
            payment_status: 'unpaid',
            shipping_status: 'pending',
            recorded_by_user_id: 'staff-1',
            shipping_address: null,
            tracking_number: null,
            shipping_provider: null,
            payment_method: 'bank_transfer',
            order_tax_subtotals: [
              {
                vat_category_code: 'S',
                vat_rate: 7.5,
                taxable_amount: 100,
                tax_amount: -7.5,
                exemption_reason: null,
              },
            ],
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
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith(
      'get_customer_order_tax_subtotals',
      { p_order_ids: ['manual-invoice'] }
    );
    expect(data.orders[0]).toMatchObject({
      current_document_kind: 'invoice',
      manual_document_available: false,
    });
  });
});
