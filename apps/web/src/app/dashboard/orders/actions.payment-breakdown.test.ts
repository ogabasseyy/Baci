import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(),
  generateOrderConfirmationText: vi.fn(),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/sanitize-core', () => ({
  sanitizeLikePattern: (value: string) => value,
  sanitizeSearchQuery: (value: string) => value,
}));

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
}));

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
  shipping_status: 'pending',
  payment_status: 'paid',
  payment_method: 'card',
  created_at: '2026-03-23T08:00:00.000Z',
  source: 'whatsapp',
  subtotal: '10000',
  shipping_fee: '1500',
  gift_wrapping_fee: '0',
  tax_amount: '0',
  tax_basis: 'exclusive',
  discount_amount: '1000',
  total: '10500',
  currency: 'NGN',
  shipping_address: {
    address: '123 Test St',
    city: 'Lagos',
    state: 'Lagos',
  },
  order_items: [
    {
      id: 'item-1',
      name: 'Widget',
      product_id: 'product-1',
      quantity: 2,
      price: 5000,
    },
  ],
};

function mockGetOrderQueries(order: Record<string, unknown> = mockOrder) {
  const ordersMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: order, error: null });
  const productsIn = vi.fn().mockResolvedValue({
    data: [
      {
        id: 'product-1',
        images: ['https://cdn.example.com/products/widget.avif'],
      },
    ],
    error: null,
  });
  const transactionsOrder = vi
    .fn()
    .mockResolvedValue({ data: [], error: null });
  const ordersSelect = vi.fn(() => ({
    eq: vi.fn((column: string, value: string) => {
      expect(column).toBe('merchant_id');
      expect(value).toBe(MERCHANT_ID);
      return {
        eq: vi.fn((nestedColumn: string, nestedValue: string) => {
          expect(nestedColumn).toBe('id');
          expect(nestedValue).toBe(ORDER_ID);
          return { maybeSingle: ordersMaybeSingle };
        }),
      };
    }),
  }));
  const productsSelect = vi.fn(() => ({ in: productsIn }));
  const transactionsSelect = vi.fn(() => ({
    eq: vi.fn((column: string, value: string) => {
      expect(column).toBe('order_id');
      expect(value).toBe(ORDER_ID);
      return { order: transactionsOrder };
    }),
  }));

  mockFrom.mockImplementation((table: string) => {
    if (table === 'orders') return { select: ordersSelect };
    if (table === 'products') return { select: productsSelect };
    if (table === 'transactions') return { select: transactionsSelect };
    throw new Error(`Unexpected table: ${table}`);
  });
}

describe('getOrder payment breakdown', () => {
  it('maps persisted payment fields and keeps the discount in the total', async () => {
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
    mockGetOrderQueries();

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(order).toMatchObject({
      discount_amount: 1000,
      gift_wrapping_fee: 0,
      shipping_fee: 1500,
      subtotal: 10000,
      tax_amount: 0,
      tax_basis: 'exclusive',
      total: 10500,
    });
    expect(order?.total).toBe(
      (order?.subtotal ?? 0) +
        (order?.shipping_fee ?? 0) +
        (order?.gift_wrapping_fee ?? 0) +
        (order?.tax_amount ?? 0) -
        (order?.discount_amount ?? 0)
    );
  });

  it('preserves the persisted total when legacy payment fields are absent', async () => {
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
    const legacyOrder = {
      ...mockOrder,
      discount_amount: null,
      gift_wrapping_fee: null,
      shipping_fee: null,
      subtotal: null,
      tax_amount: null,
      tax_basis: undefined,
      total: '10500',
    };
    mockGetOrderQueries(legacyOrder);

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(order).toMatchObject({
      discount_amount: undefined,
      gift_wrapping_fee: undefined,
      shipping_fee: undefined,
      subtotal: undefined,
      tax_amount: undefined,
      tax_basis: undefined,
      total: 10500,
    });
  });
});
