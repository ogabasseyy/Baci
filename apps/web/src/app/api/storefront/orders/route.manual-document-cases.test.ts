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

describe('GET /api/storefront/orders manual document cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    'paid',
    'partially_paid',
  ])('exposes a manual %s document without exposing the recording staff identity', async (paymentStatus) => {
    const supabase = createSupabaseMock({
      orders: {
        data: [
          {
            id: 'manual-order',
            order_number: 'MANUAL-1',
            created_at: '2026-09-30T09:00:00Z',
            total: 100,
            subtotal: 100,
            shipping_fee: 0,
            tax_amount: 0,
            discount_amount: 0,
            amount_paid: paymentStatus === 'paid' ? 100 : 50,
            currency: 'NGN',
            payment_status: paymentStatus,
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
    expect(data.orders[0]).toMatchObject({
      manual_document_available: true,
      current_document_kind: paymentStatus === 'paid' ? 'receipt' : 'invoice',
      receipt_eligible: paymentStatus === 'paid',
    });
    expect(data.orders[0]).not.toHaveProperty('recorded_by_user_id');
    expect(supabase.from('orders').select).toHaveBeenCalledWith(
      expect.stringContaining('recorded_by_user_id')
    );
  });

  it.each([
    {
      name: 'covered partial',
      payment_status: 'partially_paid',
      total: 100,
      amount_paid: 100,
    },
    {
      name: 'zero-total unpaid',
      payment_status: 'unpaid',
      total: 0,
      amount_paid: 0,
    },
  ])('pairs kind receipt with a commercial type code for a settled $name manual order', async ({
    payment_status,
    total,
    amount_paid,
  }) => {
    const supabase = createSupabaseMock({
      orders: {
        data: [
          {
            id: 'manual-order',
            order_number: 'MANUAL-1',
            created_at: '2026-09-30T09:00:00Z',
            total,
            subtotal: total,
            shipping_fee: 0,
            tax_amount: 0,
            discount_amount: 0,
            amount_paid,
            currency: 'NGN',
            payment_status,
            shipping_status: 'pending',
            recorded_by_user_id: 'staff-1',
            shipping_address: null,
            tracking_number: null,
            shipping_provider: null,
            payment_method: 'invoice',
            order_items: [
              {
                id: 'item-1',
                product_id: 'product-1',
                name: 'Device',
                quantity: 1,
                price: total,
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
    expect(data.orders[0]).toMatchObject({
      current_document_kind: 'receipt',
      invoice_type_code: '380',
      receipt_eligible: true,
    });
  });

  it('marks staff-recorded orders without exposing the recording identity', async () => {
    const supabase = createSupabaseMock({
      orders: {
        data: [
          {
            id: 'manual-order',
            order_number: 'MANUAL-1',
            created_at: '2026-09-30T09:00:00Z',
            total: 100,
            subtotal: 100,
            shipping_fee: 0,
            tax_amount: 0,
            discount_amount: 0,
            amount_paid: 100,
            currency: 'NGN',
            payment_status: 'paid',
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
          {
            id: 'storefront-order',
            order_number: 'STORE-1',
            created_at: '2026-09-30T09:00:00Z',
            total: 100,
            subtotal: 100,
            shipping_fee: 0,
            tax_amount: 0,
            discount_amount: 0,
            amount_paid: 100,
            currency: 'NGN',
            payment_status: 'paid',
            shipping_status: 'pending',
            recorded_by_user_id: null,
            shipping_address: null,
            tracking_number: null,
            shipping_provider: null,
            payment_method: 'bank_transfer',
            order_items: [
              {
                id: 'item-2',
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
    expect(data.orders[0]).toMatchObject({ is_manual_order: true });
    expect(data.orders[1]).toMatchObject({ is_manual_order: false });
    expect(data.orders[0]).not.toHaveProperty('recorded_by_user_id');
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
