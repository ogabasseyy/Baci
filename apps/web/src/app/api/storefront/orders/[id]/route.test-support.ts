import { cookies } from 'next/headers';
import { vi } from 'vitest';
import { isValidUuid, sanitizeForLog } from '@/lib/sanitize-core';
import { createAnonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';

export const mockOrderData = {
  id: 'order-uuid-123',
  order_number: 'ORD-001',
  tracking_token: 'track-token-123',
  subtotal: 10000,
  shipping_fee: 1000,
  total: 11000,
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  customer_phone: '+2348012345678',
  shipping_address: '123 Test St',
  payment_status: 'paid',
  shipping_status: 'pending',
  payment_method: 'korapay',
  merchant_id: 'merchant-uuid-456',
};

export const mockItems = [
  {
    id: 'item-1',
    product_id: 'product-1',
    name: 'Test Product',
    quantity: 2,
    price: 5000,
    products: {
      slug: 'test-product',
      gtin: '0123456789012',
      category: 'smartphones',
      categories: [{ name: 'Smartphones', slug: 'smartphones' }],
    },
  },
];

export const mockSupabaseClient = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

export const mockAnonClient = {
  rpc: vi.fn(),
  from: vi.fn(),
};

export function resetStorefrontOrderMocks() {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({} as never);
  vi.mocked(createClient).mockReturnValue(mockSupabaseClient as never);
  vi.mocked(createAnonClient).mockReturnValue(mockAnonClient as never);
  mockSupabaseClient.rpc.mockResolvedValue({ data: [], error: null });
  vi.mocked(isValidUuid).mockReturnValue(true);
  vi.mocked(sanitizeForLog).mockImplementation((value) => String(value));

  const mockAnonProductsQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'product-1',
          slug: 'test-product',
          gtin: '0123456789012',
          category: 'smartphones',
          categories: [{ name: 'Smartphones', slug: 'smartphones' }],
        },
      ],
      error: null,
    }),
  };

  mockAnonClient.from.mockImplementation((table: string) => {
    if (table === 'products') return mockAnonProductsQuery;
    return {};
  });
}
