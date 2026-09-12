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
