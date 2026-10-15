import { vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import { mockCreateAdminClient } from './shipping-route.test-support';

export const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
export const baseOrderPayload = {
  merchant_id: MERCHANT_ID,
  customer_email: 'customer@example.com',
  customer_name: 'Test Customer',
  customer_phone: '08012345678',
  items: [{ product_id: 'p-1', quantity: 1, price: 1000, name: 'Widget' }],
  subtotal: 1000,
  shipping_fee: 0,
  discount_amount: 0,
  tax_amount: 0,
  payment_method: 'paystack',
  payment_status: 'unpaid',
  shipping_status: 'pending',
  shipping_address: { address: '123 Test St', city: 'Lagos', state: 'Lagos' },
};

export function resetShippingRouteMocks() {
  vi.clearAllMocks();
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    user: null,
    error: 'Not authenticated',
    supabase: null,
  });
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { currency: 'NGN' }, error: null }),
    })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  });
}

type RpcOutcome = { data: unknown; error: unknown };
export function buildMockSupabase(
  overrides: Record<string, RpcOutcome> = {},
  opts: {
    productRows?: Record<string, unknown>[];
    shippingQuote?: unknown;
  } = {}
) {
  const merchant = {
    id: MERCHANT_ID,
    business_name: 'Test Merchant',
    country: 'NG',
    slug: 'test-merchant',
    support_email: 'support@example.com',
    email_sender_name: 'Test Store',
    email: 'merchant@example.com',
    vat_registration_status: null,
  };
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: merchant, error: null }),
    single: vi.fn().mockResolvedValue({ data: merchant, error: null }),
    in: vi.fn().mockReturnThis(),
    returns: vi
      .fn()
      .mockResolvedValue({ data: opts.productRows ?? [], error: null }),
    overrideTypes: vi
      .fn()
      .mockResolvedValue({ data: opts.productRows ?? [], error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: PostgREST queries are thenable.
    then: (resolve: (value: undefined) => unknown) =>
      Promise.resolve(undefined).then(resolve),
  };
  const outcomes: Record<string, RpcOutcome> = {
    create_storefront_order: {
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: '11111111-2222-3333-4444-555555555555',
          tracking_token: 'track-default-1',
        },
      ],
      error: null,
    },
    has_storefront_order_idempotency_key: { data: false, error: null },
    get_order_variant_overrides: { data: [], error: null },
    get_checkout_shipping_quote: {
      data: opts.shippingQuote ? [opts.shippingQuote] : null,
      error: null,
    },
    persist_storefront_order_delivery_metadata: { data: false, error: null },
    claim_immediate_order_notification_with_proof: {
      data: [
        {
          claimed: true,
          claim_status: 'processing',
          claim_token: 'lease-default-1',
        },
      ],
      error: null,
    },
  };
  return {
    auth: { getUser: vi.fn() },
    from: vi.fn((table: string) =>
      table === 'shipping_quotes'
        ? {
            ...chain,
            maybeSingle: vi.fn().mockResolvedValue({
              data: opts.shippingQuote ?? null,
              error: null,
            }),
          }
        : chain
    ),
    rpc: vi.fn((name: string) =>
      Promise.resolve(
        overrides[name] ?? outcomes[name] ?? { data: null, error: null }
      )
    ),
  };
}
