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

function configureAuthenticatedOrder() {
  mockSupabaseClient.auth.getUser.mockResolvedValue({
    data: { user: { id: 'user-123' } },
  });

  const mockOrderQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockOrderData, error: null }),
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
}

describe('GET /api/storefront/orders/[id] authenticated payment-account history', () => {
  beforeEach(resetStorefrontOrderMocks);

  it('uses the paid transaction receiver when historical aliases coexist', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    configureAuthenticatedOrder();
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [
        {
          account_number: '1111111111',
          account_name: 'Paid DVA',
          bank_name: 'Paystack',
          provider: 'paystack',
          created_at: '2026-08-24T12:00:00.000Z',
          assigned_at: '2026-08-24T12:00:00.000Z',
          expires_at: '2026-08-24T12:30:00.000Z',
          order_id: mockOrderData.id,
        },
        {
          account_number: '2222222222',
          account_name: 'Newer DVA',
          bank_name: 'Paystack',
          provider: 'paystack',
          created_at: '2026-08-24T12:20:00.000Z',
          assigned_at: '2026-08-24T12:20:00.000Z',
          expires_at: '2026-09-07T12:20:00.000Z',
          order_id: mockOrderData.id,
        },
      ],
      error: null,
    });
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [
        {
          amount: 1000,
          created_at: '2026-08-24T12:45:00.000Z',
          description: 'Paystack transfer',
          dva_account_number: '1111111111',
          gateway: 'paystack',
          id: 'transaction-1',
          order_id: 'order-uuid-123',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.virtual_account.account_number).toBe('1111111111');
  });

  it('omits a paid account when the authoritative transaction lookup fails', async () => {
    const request = new NextRequest(
      'http://localhost/api/storefront/orders/order-uuid-123'
    );
    configureAuthenticatedOrder();
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: [
        {
          account_number: '2222222222',
          account_name: 'Newer DVA',
          bank_name: 'Paystack',
          provider: 'paystack',
          created_at: '2026-08-24T12:20:00.000Z',
          assigned_at: '2026-08-24T12:20:00.000Z',
          expires_at: '2026-09-07T12:20:00.000Z',
          order_id: mockOrderData.id,
        },
      ],
      error: null,
    });
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error('customer transaction lookup failed'),
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: 'order-uuid-123' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.virtual_account).toBeNull();
  });
});
