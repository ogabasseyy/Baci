import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { GET } from './route';
import {
  createAuthenticatedAuthResult,
  createSupabaseMock,
} from './route.test-support';

describe('GET /api/storefront/orders historical payment accounts', () => {
  it('uses the paid transaction receiver when historical aliases coexist', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult(
        createSupabaseMock({
          orders: {
            data: [
              {
                id: 'order-paid-history',
                order_number: 'ORD-HISTORY-1',
                created_at: '2026-07-08T12:00:00.000Z',
                total: 100000,
                subtotal: 100000,
                shipping_fee: 0,
                tax_amount: 0,
                discount_amount: 0,
                amount_paid: 100000,
                currency: 'NGN',
                external_source: null,
                import_job_id: null,
                payment_status: 'paid',
                shipping_status: 'delivered',
                shipping_address: null,
                tracking_number: null,
                shipping_provider: null,
                payment_method: 'paystack',
                order_items: [],
                order_payment_accounts: [
                  {
                    account_name: 'Paid DVA',
                    account_number: '1111111111',
                    bank_name: 'Paystack',
                    created_at: '2026-07-08T11:00:00.000Z',
                    expires_at: '2026-07-08T12:30:00.000Z',
                    provider: 'paystack',
                  },
                  {
                    account_name: 'Newer DVA',
                    account_number: '2222222222',
                    bank_name: 'Paystack',
                    created_at: '2026-07-08T12:00:00.000Z',
                    expires_at: '2026-07-08T13:30:00.000Z',
                    provider: 'paystack',
                  },
                ],
              },
            ],
            error: null,
          },
          transactions: {
            data: [
              {
                order_id: 'order-paid-history',
                created_at: '2026-07-08T12:45:00.000Z',
                metadata: { dva_account_number: '1111111111' },
                gateway: 'paystack',
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
    expect(payload.orders[0].virtual_account).toEqual(
      expect.objectContaining({
        account_number: '1111111111',
        provider: 'paystack',
      })
    );
  });
});
