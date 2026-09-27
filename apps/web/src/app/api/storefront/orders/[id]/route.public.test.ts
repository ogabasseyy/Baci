import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn() }));
vi.mock('@/lib/sanitize-core', () => ({
  isValidUuid: vi.fn(),
  sanitizeForLog: vi.fn((value) => value),
}));

import { GET } from './route';
import {
  mockAnonClient,
  mockOrderData,
  mockSupabaseClient,
  resetStorefrontOrderMocks,
} from './route.test-support';

describe('GET /api/storefront/orders/[id] public lookup', () => {
  beforeEach(resetStorefrontOrderMocks);

  it('falls through to RPC lookup when session lookup fails and a tracking token is provided', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      return {};
    });
    mockAnonClient.rpc.mockResolvedValue({
      data: [
        {
          ...mockOrderData,
          tax_amount: 750,
          discount_amount: 500,
          gift_wrapping_fee: 1500,
          items: [
            {
              id: 'item-1',
              product_id: 'product-1',
              condition: 'used',
              name: 'Test Product',
              quantity: 2,
              price: 5000,
            },
          ],
        },
      ],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe(mockOrderData.id);
    expect(data).toMatchObject({
      tax_amount: 750,
      discount_amount: 500,
      gift_wrapping_fee: 1500,
    });
    expect(data.items[0]).toMatchObject({
      condition: 'used',
      variant_name: 'Used',
    });
    expect(mockAnonClient.rpc).toHaveBeenCalledWith('get_order_tracking', {
      p_merchant_slug: 'test-store',
      p_order_id: null,
      p_order_number: null,
      p_email: null,
      p_tracking_token: 'track-token-123',
    });
  });

  it('rejects a token lookup that resolves a different order than the path', async () => {
    // A stale or mismatched deep link (path order A, token for order B)
    // must never display order B — including its active transfer account
    // — under A's URL. Uniform 404, no existence oracle.
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    mockAnonClient.rpc.mockResolvedValue({
      data: [
        {
          ...mockOrderData,
          id: 'order-uuid-OTHER',
        },
      ],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data).toStrictEqual({ error: 'Order not found' });
  });

  it('returns the credited amount for a guest order with partial coverage', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    // A guest Pay for Me order partially covered by wallet credit: the
    // success page reconciles payer instructions from amount_paid, so
    // the proof-bound guest response must carry it (not just the
    // signed-in select).
    mockAnonClient.rpc.mockResolvedValue({
      data: [
        {
          ...mockOrderData,
          payment_status: 'unpaid',
          payment_method: 'payforme',
          total: 11000,
          amount_paid: 4000,
          items: [],
        },
      ],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ total: 11000, amount_paid: 4000 });
  });

  it('forwards the terminal notification-delivery flag for invoice gating', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    // The success page gates invoice_generated on terminal after()
    // delivery: a sent claim projects true, while older RPC projections
    // omit the flag and read as not delivered.
    mockAnonClient.rpc
      .mockResolvedValueOnce({
        data: [{ ...mockOrderData, items: [], notification_delivered: true }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ ...mockOrderData, items: [] }],
        error: null,
      });

    const delivered = await (
      await GET(request, { params: Promise.resolve({ id: 'order-uuid-123' }) })
    ).json();
    expect(delivered.notification_delivered).toBe(true);
    const pending = await (
      await GET(request, { params: Promise.resolve({ id: 'order-uuid-123' }) })
    ).json();
    expect(pending.notification_delivered).toBe(false);
  });

  it('projects the server-confirmed inventory bit for the status poll', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    // First RPC resolves the order, second resolves the proof.
    mockAnonClient.rpc
      .mockResolvedValueOnce({
        data: [{ ...mockOrderData, items: [] }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });

    const confirmed = await (
      await GET(request, { params: Promise.resolve({ id: 'order-uuid-123' }) })
    ).json();

    expect(mockAnonClient.rpc).toHaveBeenNthCalledWith(
      2,
      'get_order_inventory_proof',
      {
        p_order_id: mockOrderData.id,
        p_tracking_token: 'track-token-123',
        p_email: null,
      }
    );
    expect(confirmed.inventory_confirmed).toBe(true);
  });

  it('returns the active provisioned DVA for a guest Pay for Me lookup', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    // A guest Pay for Me checkout: the success page renders copyable
    // payer instructions from this lookup, so the proof-bound guest
    // response must carry the provisioned account — not just the
    // signed-in branch.
    mockAnonClient.rpc.mockResolvedValue({
      data: [
        {
          ...mockOrderData,
          payment_status: 'unpaid',
          payment_method: 'payforme',
          items: [],
          payment_accounts: [
            {
              account_number: '1234567890',
              bank_name: 'Paystack-Titan',
              account_name: 'Baci / Ada',
              provider: 'paystack',
              assignment_customer_email_source: 'order_email',
              created_at: new Date(Date.now() - 60_000).toISOString(),
              assigned_at: new Date(Date.now() - 60_000).toISOString(),
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
          ],
        },
      ],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.virtual_account).toMatchObject({
      account_number: '1234567890',
      bank_name: 'Paystack-Titan',
      account_name: 'Baci / Ada',
    });
  });

  it('omits expired DVAs from the guest lookup (never payable)', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    mockAnonClient.rpc.mockResolvedValue({
      data: [
        {
          ...mockOrderData,
          payment_status: 'unpaid',
          payment_method: 'payforme',
          items: [],
          payment_accounts: [
            {
              account_number: '1234567890',
              bank_name: 'Paystack-Titan',
              account_name: 'Baci / Ada',
              provider: 'paystack',
              assignment_customer_email_source: 'order_email',
              created_at: '2026-01-01T00:00:00.000Z',
              assigned_at: '2026-01-01T00:00:00.000Z',
              expires_at: '2026-01-02T00:00:00.000Z',
            },
          ],
        },
      ],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.virtual_account).toBeNull();
  });

  it('returns 400 when merchant_slug is missing for public lookup', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      'merchant_slug is required for public order lookup'
    );
  });

  it('returns 400 when tracking token and email are both missing for public lookup', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      'Tracking token or email is required'
    );
  });

  it('accepts tracking_token query parameter', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?tracking_token=track-token-456&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    mockAnonClient.rpc.mockResolvedValue({
      data: [{ ...mockOrderData, items: [] }],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAnonClient.rpc).toHaveBeenCalledWith(
      'get_order_tracking',
      expect.objectContaining({ p_tracking_token: 'track-token-456' })
    );
  });

  it('returns 200 via email lookup', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?email=john@example.com&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    mockAnonClient.rpc.mockResolvedValue({
      data: [{ ...mockOrderData, items: [] }],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).customer_email).toBe('john@example.com');
  });

  it('prefers email lookup over token lookup when both are provided', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123&email=john@example.com&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    mockAnonClient.rpc.mockResolvedValue({
      data: [{ ...mockOrderData, items: [] }],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(200);
    expect(mockAnonClient.rpc).toHaveBeenCalledWith('get_order_tracking', {
      p_merchant_slug: 'test-store',
      p_order_id: 'order-uuid-123',
      p_order_number: null,
      p_email: 'john@example.com',
      p_tracking_token: null,
    });
  });

  it('returns 404 when RPC lookup does not find an order', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=missing&merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: null },
    });
    mockAnonClient.rpc.mockResolvedValue({ data: [], error: null });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Order not found');
  });
});
