import { describe, expect, it, vi } from 'vitest';

// Mock next/headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Mock email functions
const mockGenerateOrderConfirmationEmail = vi.fn<any>(
  () => '<html>confirmation</html>'
);
const mockGenerateOrderConfirmationText = vi.fn<any>(() => 'confirmation text');

vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: mockGenerateOrderConfirmationEmail,
  generateOrderConfirmationText: mockGenerateOrderConfirmationText,
}));

// Mock sendEmail
const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/zeptomail', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// Mock sanitize functions
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeLikePattern: (s: string) => s,
  sanitizeSearchQuery: (s: string) => s,
}));

const mockEnsurePermission = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();

vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: (...args: unknown[]) => mockEnsurePermission(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
}));

// Supabase mock setup
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

// Import after mocks
const { getOrder, resendOrderConfirmation } = await import('./actions');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_ID = 'merchant-456';

type MockOrderItem = {
  id: string;
  name: string;
  product_id: string;
  quantity: number;
  price: number;
  image_url?: string;
};

const mockOrder: {
  id: string;
  merchant_id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_status: string;
  payment_status: string;
  payment_method: string;
  created_at: string;
  source: string;
  subtotal: string;
  shipping_fee: string;
  gift_wrapping_fee: string;
  tax_amount: string;
  tax_basis: string;
  discount_amount: string;
  total: string;
  currency?: string | null;
  delivery_method?: string | null;
  airport_type?: string | null;
  shipping_rate_id?: string | null;
  shipping_rate_name?: string | null;
  shipping_address: {
    address: string;
    city: string;
    state: string;
  };
  order_items: MockOrderItem[];
} = {
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

const mockMerchant: {
  id: string;
  business_name: string;
  slug: string;
  support_email: string;
  email_sender_name: string;
  email: string;
  tax_identification_number: string | null;
  cac_rc_number: string | null;
} = {
  id: MERCHANT_ID,
  business_name: 'TestShop',
  slug: 'testshop',
  support_email: 'support@testshop.com',
  email_sender_name: 'TestShop',
  email: 'owner@testshop.com',
  tax_identification_number: '1234567890',
  cac_rc_number: 'RC-12345',
};

function setupMocks(overrides?: {
  order?: typeof mockOrder | null;
  orderError?: { message: string } | null;
  merchant?: typeof mockMerchant | null;
  merchantError?: { message: string } | null;
}) {
  const order = overrides?.order !== undefined ? overrides.order : mockOrder;
  const orderError = overrides?.orderError ?? null;
  const merchant =
    overrides?.merchant !== undefined ? overrides.merchant : mockMerchant;
  const merchantError = overrides?.merchantError ?? null;

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

  mockFrom.mockImplementation((table: string) => {
    if (table === 'orders') {
      const scopedOrderQuery = vi.fn((column: string, value: string) => {
        expect(column).toBe('merchant_id');
        expect(value).toBe(MERCHANT_ID);
        return {
          single: vi.fn(() =>
            Promise.resolve({ data: order, error: orderError })
          ),
        };
      });

      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string, value: string) => {
            expect(column).toBe('id');
            expect(value).toBe(ORDER_ID);
            return {
              eq: scopedOrderQuery,
            };
          }),
        })),
      };
    }
    if (table === 'merchants') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string, value: string) => {
            expect(column).toBe('id');
            expect(value).toBe(MERCHANT_ID);
            return {
              single: vi.fn(() =>
                Promise.resolve({ data: merchant, error: merchantError })
              ),
            };
          }),
        })),
      };
    }
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
    };
  });
}

describe('resendOrderConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'admin-user' } },
      error: null,
    });
    mockEnsurePermission.mockResolvedValue({
      merchant: { id: MERCHANT_ID },
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: 'owner',
        permissions: {},
      },
    });
  });

  it('returns failure when order is not found', async () => {
    setupMocks({ order: null, orderError: { message: 'Not found' } });

    const result = await resendOrderConfirmation(ORDER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Order not found');
  });

  it('returns failure when customer has no email', async () => {
    setupMocks({
      order: { ...mockOrder, customer_email: '' },
    });

    const result = await resendOrderConfirmation(ORDER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Customer has no email address');
  });

  it('returns failure when merchant is not found', async () => {
    setupMocks({
      merchant: null,
      merchantError: { message: 'Not found' },
    });

    const result = await resendOrderConfirmation(ORDER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Merchant profile not found');
  });

  it('returns failure when permission is denied', async () => {
    mockEnsurePermission.mockRejectedValueOnce(new Error('Unauthorized'));

    const result = await resendOrderConfirmation(ORDER_ID);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to send email. Please try again.');
  });

  it('sends email successfully and returns success', async () => {
    setupMocks();

    const result = await resendOrderConfirmation(ORDER_ID);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Order confirmation email sent successfully');
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it('passes merchantTin and merchantRcNumber to email template', async () => {
    setupMocks();

    await resendOrderConfirmation(ORDER_ID);

    expect(mockGenerateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantTin: '1234567890',
        merchantRcNumber: 'RC-12345',
      })
    );
    expect(mockGenerateOrderConfirmationText).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantTin: '1234567890',
        merchantRcNumber: 'RC-12345',
      })
    );
  });

  it('passes undefined for merchantTin when merchant has no TIN', async () => {
    setupMocks({
      merchant: {
        ...mockMerchant,
        tax_identification_number: null,
        cac_rc_number: null,
      },
    });

    await resendOrderConfirmation(ORDER_ID);

    expect(mockGenerateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantTin: undefined,
        merchantRcNumber: undefined,
      })
    );
  });

  it('includes correct order data in email template', async () => {
    setupMocks();

    await resendOrderConfirmation(ORDER_ID);

    expect(mockGenerateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: '#ORD-001',
        customerName: 'John Doe',
        merchantName: 'TestShop',
        total: 10500,
        currency: 'NGN',
      })
    );
  });

  it('threads a non-NGN order currency through to the resend email', async () => {
    setupMocks({ order: { ...mockOrder, currency: 'INR' } });

    await resendOrderConfirmation(ORDER_ID);

    expect(mockGenerateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'INR' })
    );
    expect(mockGenerateOrderConfirmationText).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'INR' })
    );
  });

  it('falls back to NGN when the order has no currency recorded (legacy rows)', async () => {
    setupMocks({ order: { ...mockOrder, currency: null } });

    await resendOrderConfirmation(ORDER_ID);

    expect(mockGenerateOrderConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'NGN' })
    );
  });

  it('sends email to correct recipient', async () => {
    setupMocks();

    await resendOrderConfirmation(ORDER_ID);

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@example.com',
        toName: 'John Doe',
        emailType: 'orders',
      })
    );
  });

  it('returns failure message on unexpected error', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Network error');
    });

    const result = await resendOrderConfirmation(ORDER_ID);
    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to send email. Please try again.');
  });

  it('returns unauthorized before permission checks when caller is unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const result = await resendOrderConfirmation(ORDER_ID);

    expect(result).toEqual({ success: false, message: 'Unauthorized' });
    expect(mockEnsurePermission).not.toHaveBeenCalled();
  });

  it('returns validation failure before permission checks for invalid order IDs', async () => {
    const result = await resendOrderConfirmation('not-a-uuid');

    expect(result).toEqual({ success: false, message: 'Invalid order ID' });
    expect(mockEnsurePermission).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('getOrder', () => {
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

  function mockGetOrderQueries(options?: {
    orderRows?: (typeof mockOrder)[];
    orderError?: { message: string } | null;
  }) {
    const orderRows = options?.orderRows ?? [mockOrder];
    const orderError = options?.orderError ?? null;
    const orderNumberLookups: string[] = [];
    const ordersMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: orderRows[0] ?? null, error: orderError });
    const orderNumberMaybeSingle = vi.fn((orderNumber: string) => {
      orderNumberLookups.push(orderNumber);
      const matchedOrder =
        orderRows.find((row) => row.order_number === orderNumber) ?? null;
      return Promise.resolve({ data: matchedOrder, error: orderError });
    });
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
        if (column !== 'merchant_id' || value !== MERCHANT_ID) {
          throw new Error(`Unexpected order filter ${column}=${value}`);
        }

        return {
          eq: vi.fn((nestedColumn: string, nestedValue: string) => {
            if (nestedColumn === 'id') {
              return {
                maybeSingle: vi.fn(() => {
                  expect(nestedValue).toBe(ORDER_ID);
                  return ordersMaybeSingle();
                }),
              };
            }

            if (nestedColumn === 'order_number') {
              return {
                maybeSingle: vi.fn(() => orderNumberMaybeSingle(nestedValue)),
              };
            }

            throw new Error(
              `Unexpected nested order filter ${nestedColumn}=${nestedValue}`
            );
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
      if (table === 'orders') {
        return { select: ordersSelect };
      }

      if (table === 'products') {
        return { select: productsSelect };
      }

      if (table === 'transactions') {
        return { select: transactionsSelect };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    return {
      ordersMaybeSingle,
      orderNumberLookups,
      orderNumberMaybeSingle,
      ordersSelect,
      productsIn,
      productsSelect,
      transactionsOrder,
    };
  }

  it('returns null before merchant authorization when caller is unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order).toBeNull();
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns null when caller has no access to the requested merchant', async () => {
    mockGetMerchantForApiRequest.mockResolvedValueOnce(null);

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order).toBeNull();
    expect(mockGetMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'admin-user',
      { requestedMerchantId: MERCHANT_ID }
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('honors global wildcard view permissions for order detail lookup', async () => {
    mockGetMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_ID,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        role: 'manager',
        permissions: { '*': { '*': true } },
      },
    });
    mockGetOrderQueries();

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order?.id).toBe(ORDER_ID);
    expect(mockFrom).toHaveBeenCalledWith('orders');
  });

  it('returns null before merchant authorization when order input fails validation', async () => {
    const order = await getOrder(MERCHANT_ID, '');

    expect(order).toBeNull();
    expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('fetches an order by exact order number candidates', async () => {
    const { orderNumberLookups, productsIn, productsSelect } =
      mockGetOrderQueries();

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order?.id).toBe(ORDER_ID);
    expect(order?.orderNumber).toBe('#ORD-001');
    expect(order?.items[0]?.image).toBe(
      'https://cdn.example.com/products/widget.avif'
    );
    expect(orderNumberLookups).toEqual(['ORD-001', '#ORD-001']);
    expect(productsSelect).toHaveBeenCalledWith('id, images');
    expect(productsIn).toHaveBeenCalledWith('id', ['product-1']);
  });

  it('prefers the stored order item image snapshot over product fallback images', async () => {
    mockGetOrderQueries({
      orderRows: [
        {
          ...mockOrder,
          order_items: [
            {
              ...mockOrder.order_items[0],
              image_url: 'https://cdn.example.com/orders/gold-snapshot.avif',
            },
          ],
        },
      ],
    });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order?.items[0]?.image).toBe(
      'https://cdn.example.com/orders/gold-snapshot.avif'
    );
  });

  it('fetches an order by direct uuid lookup', async () => {
    const {
      ordersMaybeSingle,
      orderNumberMaybeSingle,
      productsIn,
      productsSelect,
      transactionsOrder,
    } = mockGetOrderQueries();

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(order?.id).toBe(ORDER_ID);
    expect(ordersMaybeSingle).toHaveBeenCalledOnce();
    expect(orderNumberMaybeSingle).not.toHaveBeenCalled();
    expect(productsSelect).toHaveBeenCalledWith('id, images');
    expect(productsIn).toHaveBeenCalledWith('id', ['product-1']);
    expect(transactionsOrder).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
  });

  it('preserves storefront order sources for dashboard labels', async () => {
    mockGetOrderQueries({
      orderRows: [{ ...mockOrder, source: 'online_store' }],
    });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order?.source).toBe('online_store');
  });

  it('maps order currency for the detail page', async () => {
    mockGetOrderQueries({
      orderRows: [{ ...mockOrder, currency: 'INR' }],
    });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order?.currency).toBe('INR');
  });

  it('selects and maps the merchant shipping rate columns for the detail page', async () => {
    const { ordersSelect } = mockGetOrderQueries({
      orderRows: [
        {
          ...mockOrder,
          shipping_rate_id: 'rate-123',
          shipping_rate_name: 'Express Lagos',
        },
      ],
    });

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    // The detail query explicitly selects the merchant-rate columns
    // (never select('*')), so fulfillment can name the rate a shopper bought.
    expect(ordersSelect).toHaveBeenCalledWith(
      expect.stringContaining('shipping_rate_id')
    );
    expect(ordersSelect).toHaveBeenCalledWith(
      expect.stringContaining('shipping_rate_name')
    );
    expect(order?.shipping_rate_id).toBe('rate-123');
    expect(order?.shipping_rate_name).toBe('Express Lagos');
  });

  it('selects and maps persisted delivery metadata for the detail page', async () => {
    const { ordersSelect } = mockGetOrderQueries({
      orderRows: [
        {
          ...mockOrder,
          airport_type: 'delivery',
          delivery_method: 'airport',
        },
      ],
    });

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(ordersSelect).toHaveBeenCalledWith(
      expect.stringContaining('delivery_method')
    );
    expect(ordersSelect).toHaveBeenCalledWith(
      expect.stringContaining('airport_type')
    );
    expect(order?.delivery_method).toBe('airport');
    expect(order?.airport_type).toBe('delivery');
  });

  it('leaves the merchant shipping rate fields undefined for legacy orders', async () => {
    mockGetOrderQueries();

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(order?.shipping_rate_id).toBeUndefined();
    expect(order?.shipping_rate_name).toBeUndefined();
  });

  it('formats legacy lowercase customer names for display', async () => {
    mockGetOrderQueries({
      orderRows: [{ ...mockOrder, customer_name: 'chidimma azubuike' }],
    });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order?.customerName).toBe('Chidimma Azubuike');
  });

  it('returns null when the order does not exist', async () => {
    const { orderNumberMaybeSingle, productsSelect, transactionsOrder } =
      mockGetOrderQueries({
        orderRows: [],
      });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order).toBeNull();
    expect(orderNumberMaybeSingle).toHaveBeenCalledTimes(2);
    expect(productsSelect).not.toHaveBeenCalled();
    expect(transactionsOrder).not.toHaveBeenCalled();
  });

  it('returns null when the order lookup is rejected as unauthenticated', async () => {
    const { orderNumberMaybeSingle, productsSelect, transactionsOrder } =
      mockGetOrderQueries({
        orderRows: [],
        orderError: { message: 'Unauthenticated' },
      });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order).toBeNull();
    expect(orderNumberMaybeSingle).toHaveBeenCalledOnce();
    expect(productsSelect).not.toHaveBeenCalled();
    expect(transactionsOrder).not.toHaveBeenCalled();
  });

  it('returns null when the order query fails', async () => {
    const { orderNumberMaybeSingle, productsSelect, transactionsOrder } =
      mockGetOrderQueries({
        orderRows: [],
        orderError: { message: 'DB error' },
      });

    const order = await getOrder(MERCHANT_ID, 'ORD-001');

    expect(order).toBeNull();
    expect(orderNumberMaybeSingle).toHaveBeenCalledOnce();
    expect(productsSelect).not.toHaveBeenCalled();
    expect(transactionsOrder).not.toHaveBeenCalled();
  });

  it('returns null when the direct uuid lookup does not find an order', async () => {
    const {
      ordersMaybeSingle,
      orderNumberMaybeSingle,
      productsSelect,
      transactionsOrder,
    } = mockGetOrderQueries({
      orderRows: [],
    });

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(order).toBeNull();
    expect(ordersMaybeSingle).toHaveBeenCalledOnce();
    expect(orderNumberMaybeSingle).not.toHaveBeenCalled();
    expect(productsSelect).not.toHaveBeenCalled();
    expect(transactionsOrder).not.toHaveBeenCalled();
  });

  it('returns null when the direct uuid lookup fails', async () => {
    const {
      ordersMaybeSingle,
      orderNumberMaybeSingle,
      productsSelect,
      transactionsOrder,
    } = mockGetOrderQueries({
      orderRows: [],
      orderError: { message: 'DB error' },
    });

    const order = await getOrder(MERCHANT_ID, ORDER_ID);

    expect(order).toBeNull();
    expect(ordersMaybeSingle).toHaveBeenCalledOnce();
    expect(orderNumberMaybeSingle).not.toHaveBeenCalled();
    expect(productsSelect).not.toHaveBeenCalled();
    expect(transactionsOrder).not.toHaveBeenCalled();
  });
});
