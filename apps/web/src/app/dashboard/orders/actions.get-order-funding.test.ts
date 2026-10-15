import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/sanitize-core', () => ({
  sanitizeLikePattern: (value: string) => value,
  sanitizeSearchQuery: (value: string) => value,
}));

const mockGetMerchantForApiRequest = vi.fn();
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
}));

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

// Import after mocks
const { getOrder } = await import('./actions');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_ID = 'merchant-456';

const mockOrder = {
  id: ORDER_ID,
  merchant_id: MERCHANT_ID,
  order_number: '#ORD-001',
  customer_name: 'John Doe',
  customer_email: 'john@example.com',
  customer_phone: '+2348012345678',
  shipping_status: 'Processing',
  payment_status: 'Paid',
  payment_method: 'card',
  created_at: '2026-01-01T00:00:00Z',
  source: 'online_store',
  subtotal: '100',
  shipping_fee: '0',
  gift_wrapping_fee: '0',
  tax_amount: '0',
  tax_basis: '0',
  discount_amount: '0',
  total: '100',
  shipping_address: { address: 'Lagos', city: 'Lagos', state: 'Lagos' },
  order_items: [],
};

describe('getOrder funding resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user' } },
      error: null,
    });
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ID,
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: null,
        permissions: { full_access: { all: true } },
      },
    });
  });

  it('leaves funding unknown when the transactions read fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({ data: mockOrder, error: null })
                ),
              })),
            })),
          })),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        };
      }
      if (table === 'transactions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi
                  .fn()
                  .mockResolvedValue({
                    data: [],
                    error: { message: 'connection reset' },
                  }),
              })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    // The page still renders; undefined funding fails the refund
    // panel open instead of hiding recovery on a transient error.
    expect(order?.id).toBe(ORDER_ID);
    expect(order?.transactions).toBeUndefined();
  });
});
