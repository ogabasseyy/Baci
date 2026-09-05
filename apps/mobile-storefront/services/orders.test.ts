import { jest } from '@jest/globals';
import type { CreateOrderRequest } from './orders';

type MockAuthUserResponse = {
  data: { user: { id: string } | null };
  error: null;
};

type MockAuthSessionResponse = {
  data: { session: { access_token: string } | null };
  error?: null;
};

type MockCreateOrderApiResponse = {
  order: {
    id: string;
    order_number: string;
    total: number;
    payment_status: string;
    shipping_status: string;
    tracking_token: string | null;
    created_at?: string;
  };
  wallet: null;
  amountDueToGateway: number;
};

const mockNetInfoFetch = jest.fn<() => Promise<{ isConnected: boolean }>>();
const mockSupabaseGetUser = jest.fn<() => Promise<MockAuthUserResponse>>();
const mockSupabaseGetSession =
  jest.fn<() => Promise<MockAuthSessionResponse>>();
const mockFetchJson = jest.fn<() => Promise<MockCreateOrderApiResponse>>();

type MockFetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

type MockFetchOptions = {
  body: string;
  headers?: Record<string, string>;
};

const mockFetchResponse: MockFetchResponse = {
  ok: true,
  status: 200,
  json: mockFetchJson,
};
interface RetryOptions {
  maxRetries?: number;
  timeout?: number;
}

const mockFetchWithRetry = jest.fn<
  (
    url: string,
    options?: MockFetchOptions,
    retryOptions?: RetryOptions
  ) => Promise<MockFetchResponse>
>(async () => mockFetchResponse);

mockNetInfoFetch.mockResolvedValue({ isConnected: true });
mockSupabaseGetUser.mockResolvedValue({
  data: { user: { id: 'user-1' } },
  error: null,
});
mockSupabaseGetSession.mockResolvedValue({
  data: { session: { access_token: 'token-123' } },
  error: null,
});
mockFetchJson.mockResolvedValue({
  order: {
    id: 'order-1',
    order_number: 'ORD-001',
    total: 720000,
    payment_status: 'unpaid',
    shipping_status: 'pending',
    created_at: '2026-03-31T00:00:00Z',
    tracking_token: null,
  },
  wallet: null,
  amountDueToGateway: 720000,
});

jest.mock('@react-native-community/netinfo', () => ({
  fetch: mockNetInfoFetch,
}));

jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: { merchantId: 'merchant-1', apiUrl: 'https://test.api' },
    },
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    require('node:crypto').createHash('sha256').update(value).digest('hex'),
}));

jest.mock('@/stores/cart-store', () => ({
  useCartStore: { getState: () => ({ checkoutGeneration: 'cart-one' }) },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: jest.fn(),
  trackError: jest.fn(),
}));

jest.mock('@/lib/offline-queue', () => ({
  offlineQueue: { enqueue: jest.fn() },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mockSupabaseGetUser,
      getSession: mockSupabaseGetSession,
    },
  },
}));

jest.mock('@/lib/api', () => ({
  fetchWithRetry: mockFetchWithRetry,
  DEFAULT_TIMEOUT: 30000,
  ApiError: class extends Error {
    code: string;

    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  NetworkError: class extends Error {},
  RetryExhaustedError: class extends Error {},
  TimeoutError: class extends Error {},
}));

type CreateOrderResult = {
  order: {
    created_at: string;
  };
};

type TestOrderItem = CreateOrderRequest['items'][number];

function getLastFetchCall(): [string, MockFetchOptions] {
  const fetchCall = mockFetchWithRetry.mock.calls.at(-1) as
    | [string, MockFetchOptions]
    | undefined;

  if (!fetchCall) {
    throw new Error(
      'Expected fetchWithRetry to be called before reading the request body'
    );
  }

  if (!fetchCall[1]?.body) {
    throw new Error(
      `Expected fetchWithRetry to be called with a JSON body, received: ${JSON.stringify(fetchCall)}`
    );
  }

  return fetchCall;
}

function getLastFetchBody() {
  const [, options] = getLastFetchCall();
  return JSON.parse(options.body);
}

function getLastFetchOptions(): MockFetchOptions {
  const [, options] = getLastFetchCall();
  return options;
}

async function createOrderWithItems(items: TestOrderItem[]) {
  const { createOrder } = require('./orders') as typeof import('./orders');

  await createOrder({
    customer_email: 'test@example.com',
    customer_name: 'Test User',
    customer_phone: '+2348012345678',
    items,
    subtotal: items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    ),
    shipping_fee: 2000,
    payment_method: 'card',
    source: 'mobile',
    shipping_address: {
      firstName: 'Test',
      lastName: 'User',
      address: '123 St',
      city: 'Lagos',
      state: 'Lagos',
    },
  });
}

describe('createOrder — variant_attributes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchResponse.ok = true;
    mockFetchResponse.status = 200;
    mockFetchJson.mockResolvedValue({
      order: {
        id: 'order-1',
        order_number: 'ORD-001',
        total: 720000,
        payment_status: 'unpaid',
        shipping_status: 'pending',
        created_at: '2026-03-31T00:00:00Z',
        tracking_token: null,
      },
      wallet: null,
      amountDueToGateway: 720000,
    });
  });

  it('reuses the order key after returning from an unpaid payment attempt', async () => {
    const items = [
      { id: 'buds2', name: 'Samsung Galaxy Buds2', price: 85000, quantity: 1 },
    ];
    await createOrderWithItems(items);
    const firstKey = getLastFetchOptions().headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    await createOrderWithItems(items);
    expect(getLastFetchOptions().headers?.['Idempotency-Key']).toBe(firstKey);
  });

  it('reuses the order key when the first response is lost', async () => {
    const items = [
      { id: 'buds2', name: 'Samsung Galaxy Buds2', price: 85000, quantity: 1 },
    ];
    mockFetchWithRetry.mockRejectedValueOnce(
      new Error('Network request failed')
    );
    await expect(createOrderWithItems(items)).rejects.toThrow();
    const firstKey = getLastFetchOptions().headers?.['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    await createOrderWithItems(items);
    expect(getLastFetchOptions().headers?.['Idempotency-Key']).toBe(firstKey);
  });

  it('includes variant_attributes in the API payload', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 720000,
          image_url: 'https://cdn.example.com/space-gray.jpg',
          variant_id: 'v-256gb',
          variant_attributes: { storage: '256GB', color: 'Space Gray' },
        },
      ],
      subtotal: 720000,
      shipping_fee: 2000,
      payment_method: 'card',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        image_url: 'https://cdn.example.com/space-gray.jpg',
        variant_id: 'v-256gb',
        variant_attributes: { storage: '256GB', color: 'Space Gray' },
      })
    );
  });

  it('includes selected condition and variant name in the API payload', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: '13" MacBook Air M2 (2022)',
          quantity: 1,
          price: 690000,
          condition: 'Open Box',
          variant_id: 'v-open-box-512',
          variant_name: '512GB',
          variant_attributes: { storage: '512GB' },
        } as TestOrderItem,
      ],
      subtotal: 690000,
      shipping_fee: 2000,
      payment_method: 'card',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        condition: 'Open Box',
        variant_id: 'v-open-box-512',
        variant_name: '512GB',
        variant_attributes: { storage: '512GB' },
      })
    );
  });

  it('includes the selected image_url in the API payload', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 720000,
          image_url: 'https://cdn.example.com/gold.jpg',
        },
      ],
      subtotal: 720000,
      shipping_fee: 2000,
      payment_method: 'card',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.items[0].image_url).toBe('https://cdn.example.com/gold.jpg');
  });

  it('forwards a trimmed voucher_token for token-only quiz voucher items', async () => {
    await createOrderWithItems([
      {
        id: 'prod-1',
        product_id: 'prod-1',
        name: 'Quiz Voucher Item',
        quantity: 1,
        price: 0,
        voucher_token: '  voucher-token-1  ',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0].voucher_token).toBe('voucher-token-1');
    expect(body.items[0]).not.toHaveProperty('voucher_award_id');
  });

  it('accepts a realistic-length quiz voucher token (>128 chars)', async () => {
    // Real tokens are qv1.<base64url payload>.<base64url HMAC> ~250-400 chars.
    // The old 128 cap rejected every real token client-side before send.
    const realisticToken = `qv1.${'A'.repeat(220)}.${'B'.repeat(43)}`;
    expect(realisticToken.length).toBeGreaterThan(128);

    await createOrderWithItems([
      {
        id: 'prod-1',
        product_id: 'prod-1',
        name: 'Quiz Voucher Item',
        quantity: 1,
        price: 0,
        voucher_token: realisticToken,
        voucher_award_id: '11111111-1111-4111-8111-111111111111',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0].voucher_token).toBe(realisticToken);
  });

  it('rejects blank voucher_token values after trimming', async () => {
    await expect(
      createOrderWithItems([
        {
          id: 'prod-1',
          product_id: 'prod-1',
          name: 'Quiz Voucher Item',
          quantity: 1,
          price: 0,
          voucher_token: '   ',
        },
      ])
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('Voucher token'),
    });

    expect(mockFetchWithRetry).not.toHaveBeenCalled();
  });

  it('forwards a trimmed voucher_award_id for award-id-only quiz voucher items', async () => {
    await createOrderWithItems([
      {
        id: 'prod-1',
        product_id: 'prod-1',
        name: 'Quiz Voucher Item',
        quantity: 1,
        price: 0,
        voucher_award_id: '  voucher-award-1  ',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0]).not.toHaveProperty('voucher_token');
    expect(body.items[0].voucher_award_id).toBe('voucher-award-1');
  });

  it('rejects blank voucher_award_id values after trimming', async () => {
    await expect(
      createOrderWithItems([
        {
          id: 'prod-1',
          product_id: 'prod-1',
          name: 'Quiz Voucher Item',
          quantity: 1,
          price: 0,
          voucher_award_id: '   ',
        },
      ])
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('Voucher award ID'),
    });

    expect(mockFetchWithRetry).not.toHaveBeenCalled();
  });

  it('serializes voucher identifiers across mixed multi-item carts', async () => {
    await createOrderWithItems([
      {
        id: 'prod-paid-1',
        product_id: 'prod-paid-1',
        name: 'Paid Item',
        quantity: 1,
        price: 720000,
      },
      {
        id: 'prod-voucher-token',
        product_id: 'prod-voucher-token',
        name: 'Token Voucher Item',
        quantity: 1,
        price: 0,
        voucher_token: 'voucher-token-2',
        voucher_award_id: 'voucher-award-2',
      },
      {
        id: 'prod-voucher-award',
        product_id: 'prod-voucher-award',
        name: 'Award Only Voucher Item',
        quantity: 1,
        price: 0,
        voucher_award_id: 'voucher-award-3',
      },
    ]);

    const body = getLastFetchBody();
    expect(body.items[0]).not.toHaveProperty('voucher_token');
    expect(body.items[0]).not.toHaveProperty('voucher_award_id');
    expect(body.items[1].voucher_token).toBe('voucher-token-2');
    expect(body.items[1].voucher_award_id).toBe('voucher-award-2');
    expect(body.items[2]).not.toHaveProperty('voucher_token');
    expect(body.items[2].voucher_award_id).toBe('voucher-award-3');
  });

  it('supports guest checkout when no authenticated session is present', async () => {
    const { createOrder } = require('./orders');

    mockSupabaseGetSession.mockResolvedValueOnce({
      data: { session: null },
    });
    mockSupabaseGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    await createOrder({
      customer_email: 'guest@example.com',
      customer_name: 'Guest User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-guest-1',
          name: 'Guest Checkout Item',
          quantity: 1,
          price: 120000,
        },
      ],
      subtotal: 120000,
      shipping_fee: 2000,
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Guest',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    expect(getLastFetchOptions()?.headers).not.toHaveProperty('Authorization');

    const body = getLastFetchBody();
    expect(body).not.toHaveProperty('user_id');
    expect(body.payment_method).toBe('pay_on_delivery');
  });

  it('uses a caller-provided idempotency key header without serializing it into the order body', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'buyer@example.com',
      customer_name: 'Buyer User',
      customer_phone: '+2348012345678',
      idempotency_key: 'mobile-bnpl-key-1',
      items: [
        {
          id: 'prod-bnpl-1',
          name: 'BNPL Phone',
          quantity: 1,
          price: 120000,
        },
      ],
      payment_method: 'credit_direct',
      shipping_address: {
        address: '123 St',
        city: 'Lagos',
        firstName: 'Buyer',
        lastName: 'User',
        state: 'Lagos',
      },
      shipping_fee: 2000,
      subtotal: 120000,
    });

    expect(getLastFetchOptions().headers?.['Idempotency-Key']).toBe(
      'mobile-bnpl-key-1'
    );
    expect(getLastFetchBody()).not.toHaveProperty('idempotency_key');
  });

  it('includes the selected shipping quote metadata in the API payload', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 720000,
        },
      ],
      subtotal: 720000,
      shipping_fee: 3638,
      tax_amount: 54000,
      selected_quote_id: '98dd0f44-d780-4829-9163-3e8a088dcf95',
      shipping_provider: 'TOPSHIP',
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.selected_quote_id).toBe('98dd0f44-d780-4829-9163-3e8a088dcf95');
    expect(body.shipping_provider).toBe('TOPSHIP');
  });

  it('passes maxRetries: 0 to fetchWithRetry so orders are never automatically retried', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
      subtotal: 5000,
      shipping_fee: 500,
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const retryOptions = mockFetchWithRetry.mock.calls.at(-1)?.[2];
    expect(retryOptions?.maxRetries).toBe(0);
  });

  it('surfaces known server validation details instead of the generic create-order error', async () => {
    const { createOrder } = require('./orders');

    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: jest.fn(() =>
        Promise.resolve({
          details: 'insufficient_stock',
          error: 'Failed to create order',
        })
      ),
    });

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        subtotal: 5000,
        shipping_fee: 500,
        payment_method: 'credit_direct',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: 'insufficient_stock',
      message:
        'This item is no longer available in the selected quantity. Please update your cart and try again.',
    });
  });

  it.each([
    {
      details: 'insufficient_variant_stock',
      message:
        'This item is no longer available in the selected option. Please update your cart and try again.',
    },
    {
      details: 'shipping_quote_required',
      message:
        'Delivery pricing changed. Please return to delivery and select a shipping option again.',
    },
    {
      details: 'order_total_mismatch',
      message:
        'Your cart total changed. Please review your order and try again.',
    },
  ])('maps server validation detail $details', async ({ details, message }) => {
    const { createOrder } = require('./orders');

    mockFetchWithRetry.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: jest.fn(() =>
        Promise.resolve({
          details,
          error: 'Failed to create order',
        })
      ),
    });

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        subtotal: 5000,
        shipping_fee: 500,
        payment_method: 'credit_direct',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details,
      message,
    });
  });

  it.each([
    ['CHECKOUT_ORDER_NOT_REUSABLE', 'CHECKOUT_ORDER_NOT_REUSABLE'],
    ['order_not_reusable', 'CHECKOUT_ORDER_NOT_REUSABLE'],
    ['checkout_idempotency_conflict', 'CHECKOUT_IDEMPOTENCY_CONFLICT'],
  ])('normalizes checkout conflict code %s from the API', async (apiCode, expectedCode) => {
    const { createOrder } = require('./orders');

    mockFetchResponse.ok = false;
    mockFetchResponse.status = 409;
    mockFetchJson.mockResolvedValueOnce({
      code: apiCode,
      error:
        'This checkout order can no longer be reused. Refresh checkout and start a new order.',
    } as never);

    await expect(
      createOrder({
        customer_email: 'buyer@example.com',
        customer_name: 'Buyer User',
        customer_phone: '+2348012345678',
        idempotency_key: 'mobile-bnpl-key-1',
        items: [
          {
            id: 'prod-bnpl-1',
            name: 'BNPL Phone',
            quantity: 1,
            price: 120000,
          },
        ],
        payment_method: 'credit_direct',
        shipping_address: {
          address: '123 St',
          city: 'Lagos',
          firstName: 'Buyer',
          lastName: 'User',
          state: 'Lagos',
        },
        shipping_fee: 2000,
        subtotal: 120000,
      })
    ).rejects.toMatchObject({
      code: expectedCode,
      details: expect.objectContaining({
        code: expectedCode,
      }),
    });
  });

  it('forwards use_wallet_credit and wallet_amount when both are provided', async () => {
    // Regression: PR A wires the storefront wallet payment-method into checkout.
    // The createOrder service layer must thread these fields through to the API,
    // otherwise the picker selection in the UI would never reach the server.
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 720000,
        },
      ],
      subtotal: 720000,
      shipping_fee: 2000,
      payment_method: 'paystack',
      use_wallet_credit: true,
      wallet_amount: 500,
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.use_wallet_credit).toBe(true);
    expect(body.wallet_amount).toBe(500);
  });

  it('forwards complete savings credit fields', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 720000,
        },
      ],
      payment_method: 'paystack',
      savings_amount: 500,
      savings_goal_id: ' 123e4567-e89b-12d3-a456-426614174555 ',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
      shipping_fee: 2000,
      subtotal: 720000,
      use_savings_credit: true,
    });

    const body = getLastFetchBody();
    expect(body.use_savings_credit).toBe(true);
    expect(body.savings_goal_id).toBe('123e4567-e89b-12d3-a456-426614174555');
    expect(body.savings_amount).toBe(500);
  });

  it('strips savings fields when the savings selection is incomplete', async () => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
      payment_method: 'paystack',
      savings_amount: 500,
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
      shipping_fee: 500,
      subtotal: 5000,
      use_savings_credit: true,
    });

    const body = getLastFetchBody();
    expect(body).not.toHaveProperty('use_savings_credit');
    expect(body).not.toHaveProperty('savings_goal_id');
    expect(body).not.toHaveProperty('savings_amount');
  });

  it('omits wallet fields entirely when neither is provided (back-compat)', async () => {
    // Pin the back-compat contract: orders that do not opt into wallet must
    // not emit `use_wallet_credit: false / wallet_amount: undefined`. The
    // server schema treats absent fields differently from explicit nullish
    // values, and serialising undefined as null can flip the wallet path.
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
      subtotal: 5000,
      shipping_fee: 500,
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body).not.toHaveProperty('use_wallet_credit');
    expect(body).not.toHaveProperty('wallet_amount');
  });

  it.each([
    'invoice',
    'payforme',
    'pay_on_delivery',
  ] as const)('marks %s orders as pending in the create-order API payload', async (paymentMethod) => {
    const { createOrder } = require('./orders');

    await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
      subtotal: 5000,
      shipping_fee: 500,
      payment_method: paymentMethod,
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    });

    const body = getLastFetchBody();
    expect(body.payment_method).toBe(paymentMethod);
    expect(body.payment_status).toBe('pending');
  });

  it('strips wallet fields when use_wallet_credit is true but wallet_amount is missing or zero', async () => {
    // Runtime guard: a malformed `{ use_wallet_credit: true,
    // wallet_amount: undefined | 0 }` must NOT reach the API. The schema
    // permits these values (wallet_amount is optional + nonnegative), so
    // the runtime guard is the layer that drops them. Negative amounts
    // are caught one layer earlier by the Zod schema itself — see the
    // dedicated rejection test below.
    const { createOrder } = require('./orders');

    for (const walletAmount of [undefined, 0]) {
      jest.clearAllMocks();
      mockFetchJson.mockResolvedValue({
        order: {
          id: 'order-x',
          order_number: 'ORD-X',
          total: 5500,
          payment_status: 'unpaid',
          shipping_status: 'pending',
          created_at: '2026-03-31T00:00:00Z',
          tracking_token: null,
        },
        wallet: null,
        amountDueToGateway: 5500,
      });

      await createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        subtotal: 5000,
        shipping_fee: 500,
        payment_method: 'paystack',
        use_wallet_credit: true,
        ...(walletAmount !== undefined && { wallet_amount: walletAmount }),
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
      });

      const body = getLastFetchBody();
      expect(body).not.toHaveProperty('use_wallet_credit');
      expect(body).not.toHaveProperty('wallet_amount');
    }
  });

  it('rejects negative wallet_amount at the schema boundary', async () => {
    const { createOrder } = require('./orders');

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        subtotal: 5000,
        shipping_fee: 500,
        payment_method: 'paystack',
        use_wallet_credit: true,
        wallet_amount: -100,
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects negative savings_amount at the schema boundary', async () => {
    const { createOrder } = require('./orders');

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        payment_method: 'paystack',
        savings_amount: -100,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
        shipping_fee: 500,
        subtotal: 5000,
        use_savings_credit: true,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects savings_amount above the mobile safety cap', async () => {
    const { createOrder } = require('./orders');

    await expect(
      createOrder({
        customer_email: 'test@example.com',
        customer_name: 'Test User',
        customer_phone: '+2348012345678',
        items: [{ id: 'prod-1', name: 'Product', quantity: 1, price: 5000 }],
        payment_method: 'paystack',
        savings_amount: 10_000_001,
        savings_goal_id: '123e4567-e89b-12d3-a456-426614174555',
        shipping_address: {
          firstName: 'Test',
          lastName: 'User',
          address: '123 St',
          city: 'Lagos',
          state: 'Lagos',
        },
        shipping_fee: 500,
        subtotal: 5000,
        use_savings_credit: true,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts successful order responses that omit created_at', async () => {
    const { createOrder } = require('./orders');

    mockFetchJson.mockResolvedValueOnce({
      order: {
        id: 'order-2',
        order_number: 'ORD-002',
        total: 122000,
        payment_status: 'pending',
        shipping_status: 'pending',
        tracking_token: null,
      },
      wallet: null,
      amountDueToGateway: 122000,
    });

    const result = (await createOrder({
      customer_email: 'test@example.com',
      customer_name: 'Test User',
      customer_phone: '+2348012345678',
      items: [
        {
          id: 'prod-1',
          name: 'MacBook Air M1',
          quantity: 1,
          price: 120000,
        },
      ],
      subtotal: 120000,
      shipping_fee: 2000,
      payment_method: 'pay_on_delivery',
      shipping_address: {
        firstName: 'Test',
        lastName: 'User',
        address: '123 St',
        city: 'Lagos',
        state: 'Lagos',
      },
    })) as CreateOrderResult;

    expect(result.order.created_at).toEqual(expect.any(String));
  });
});

describe('createOrderWithOfflineSupport — offline queue contract', () => {
  const baseRequest = {
    customer_email: 'buyer@example.com',
    customer_name: 'Test Buyer',
    customer_phone: '+2348012345678',
    items: [{ id: 'item-1', name: 'Product', quantity: 1, price: 5000 }],
    subtotal: 5000,
    shipping_fee: 500,
    payment_method: 'pay_on_delivery' as const,
    shipping_address: {
      firstName: 'Test',
      lastName: 'Buyer',
      address: '123 St',
      city: 'Lagos',
      state: 'Lagos',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    mockSupabaseGetSession.mockResolvedValue({
      data: { session: { access_token: 'token-123' } },
    });
    mockSupabaseGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    const { offlineQueue } = require('@/lib/offline-queue');
    jest.mocked(offlineQueue.enqueue).mockResolvedValue('queue-id-1');
  });

  it('returns the order without queuing when the request succeeds', async () => {
    const { createOrderWithOfflineSupport } = require('./orders');
    mockFetchWithRetry.mockResolvedValueOnce(mockFetchResponse);

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(false);
    expect(result.order).toBeDefined();
    const { offlineQueue } = require('@/lib/offline-queue');
    expect(offlineQueue.enqueue).not.toHaveBeenCalled();
  });

  it('queues the order when createOrder encounters a NETWORK_ERROR', async () => {
    const { createOrderWithOfflineSupport } = require('./orders');
    const { NetworkError } = require('@/lib/api');
    mockFetchWithRetry.mockRejectedValueOnce(
      new NetworkError('connection refused')
    );

    const result = await createOrderWithOfflineSupport(baseRequest);

    expect(result.queued).toBe(true);
    const { offlineQueue } = require('@/lib/offline-queue');
    expect(offlineQueue.enqueue).toHaveBeenCalledWith(
      'create_order',
      baseRequest
    );
  });

  it('re-throws TIMEOUT_ERROR without queuing to avoid duplicate orders', async () => {
    const { createOrderWithOfflineSupport } = require('./orders');
    const { TimeoutError } = require('@/lib/api');
    mockFetchWithRetry.mockRejectedValueOnce(new TimeoutError('timed out'));

    await expect(
      createOrderWithOfflineSupport(baseRequest)
    ).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR',
    });

    const { offlineQueue } = require('@/lib/offline-queue');
    expect(offlineQueue.enqueue).not.toHaveBeenCalled();
  });
});
