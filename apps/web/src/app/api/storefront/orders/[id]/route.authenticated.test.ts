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
  mockItems,
  mockOrderData,
  mockSupabaseClient,
  resetStorefrontOrderMocks,
} from './route.test-support';

describe('GET /api/storefront/orders/[id] authenticated lookup', () => {
  beforeEach(resetStorefrontOrderMocks);

  it('returns an authenticated order and derives category_slug from product joins', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          ...mockOrderData,
          tax_amount: 750,
          discount_amount: 500,
          gift_wrapping_fee: 1500,
        },
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
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
    expect(mockOrderQuery.select.mock.calls[0][0]).toContain('tax_amount');
    expect(mockOrderQuery.select.mock.calls[0][0]).toContain('discount_amount');
    expect(mockOrderQuery.select.mock.calls[0][0]).toContain(
      'gift_wrapping_fee'
    );
    expect(data.items).toEqual([
      {
        id: 'item-1',
        product_id: 'product-1',
        product_name: 'Test Product',
        name: 'Test Product',
        quantity: 2,
        price: 5000,
        condition: null,
        variant_name: null,
        gtin: '0123456789012',
        product_slug: 'test-product',
        category: 'smartphones',
        category_slug: 'smartphones',
        categories: { name: 'Smartphones', slug: 'smartphones' },
      },
    ]);
  });

  it('returns the stamped currency from an authenticated lookup', async () => {
    // A signed-in shopper resuming an order after the merchant changes
    // payout currency must still map the order's original currency.
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          ...mockOrderData,
          currency: 'USD',
        },
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockOrderQuery.select.mock.calls[0][0]).toContain('currency');
    expect(data.currency).toBe('USD');
  });

  it('returns 404 when an authenticated order does not match the requested merchant slug', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?merchant_slug=other-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrderData, error: null }),
    };
    const mockMerchantQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'different-merchant-id' },
        error: null,
      }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'merchants') return mockMerchantQuery;
      return {};
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Order not found');
  });

  it('returns an authenticated order when the requested merchant slug matches', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?merchant_slug=test-store'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrderData, error: null }),
    };
    const mockMerchantQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: mockOrderData.merchant_id },
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'merchants') return mockMerchantQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(mockOrderData.id);
    expect(mockMerchantQuery.eq).toHaveBeenCalledWith('slug', 'test-store');
  });

  it('exposes only the selected payment account, not historical account rows', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          ...mockOrderData,
          order_payment_accounts: [
            {
              account_number: '0123456789',
              account_name: 'Current account',
              bank_name: 'Paystack-Titan',
              provider: 'paystack',
              created_at: '2026-08-24T12:00:00.000Z',
              assigned_at: '2026-08-24T12:00:00.000Z',
              expires_at: '2026-09-07T12:00:00.000Z',
            },
          ],
        },
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [
        {
          account_number: '0123456789',
          account_name: 'Current account',
          bank_name: 'Paystack-Titan',
          provider: 'paystack',
          created_at: '2026-08-24T12:00:00.000Z',
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-09-07T12:00:00.000Z',
          order_id: mockOrderData.id,
        },
      ],
      error: null,
    });
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.virtual_account).toEqual({
      account_number: '0123456789',
      account_name: 'Current account',
      bank_name: 'Paystack-Titan',
      provider: 'paystack',
      created_at: '2026-08-24T12:00:00.000Z',
      assigned_at: '2026-08-24T12:00:00.000Z',
      expires_at: '2026-09-07T12:00:00.000Z',
    });
    expect(data).not.toHaveProperty('order_payment_accounts');
  });

  it('returns 500 when payment accounts cannot be loaded', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockOrderData, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      return {};
    });
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'payment account RPC unavailable' },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe(
      'Failed to fetch payment accounts'
    );
  });

  it.each([
    true,
    false,
  ])('returns notification_delivered=%s from the delivery RPC', async (delivered) => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: mockOrderData,
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
    });
    mockSupabaseClient.rpc.mockImplementation((name: string) => {
      if (name === 'get_order_notification_delivered') {
        return Promise.resolve({ data: delivered, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notification_delivered).toBe(delivered);
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'get_order_notification_delivered',
      { p_order_id: mockOrderData.id }
    );
  });

  it.each([
    true,
    false,
  ])('returns inventory_confirmed=%s from the proof RPC', async (confirmed) => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123?token=track-token-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: mockOrderData,
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
    });
    mockSupabaseClient.rpc.mockImplementation((name: string) => {
      if (name === 'get_order_inventory_proof') {
        return Promise.resolve({ data: confirmed, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.inventory_confirmed).toBe(confirmed);
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'get_order_inventory_proof',
      { p_order_id: mockOrderData.id, p_tracking_token: 'track-token-123' }
    );
  });

  it('reads notification_delivered as false when the delivery RPC errors', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    mockSupabaseClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
    });

    const mockOrderQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: mockOrderData,
        error: null,
      }),
    };
    const mockItemsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockItems, error: null }),
    };
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'orders') return mockOrderQuery;
      if (table === 'order_items') return mockItemsQuery;
      return {};
    });
    mockSupabaseClient.rpc.mockImplementation((name: string) => {
      if (name === 'get_order_notification_delivered') {
        return Promise.resolve({
          data: null,
          error: { message: 'delivery RPC unavailable' },
        });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notification_delivered).toBe(false);
  });
});
