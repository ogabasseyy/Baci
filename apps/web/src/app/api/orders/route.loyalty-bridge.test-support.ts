// Shared harness for the loyalty-bridge orders suites (issue #3165):
// mock Supabase wiring for POST /api/orders with an RDM-* code.
import { vi } from 'vitest';
import {
  authenticateApiRequest,
  mockCreateAdminClient,
  NextRequest,
} from './route.loyalty-bridge.mocks.test-support';

// Loyalty-checkout cases (issue #3165), split from oversized route.test.ts.
export const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
export const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';

export type RpcOutcome = { data: unknown; error: unknown };

export function buildLoyaltyMockSupabase(
  overrides: Record<string, RpcOutcome> = {},
  productRows: Array<{ id: string; price: number }> = []
) {
  const merchantRow = {
    id: MERCHANT_ID,
    business_name: 'Test Merchant',
    country: 'NG',
    slug: 'test-merchant',
    support_email: 'support@example.com',
    email_sender_name: 'Test Store',
    email: 'merchant@example.com',
    vat_registration_status: null,
  };
  const chainable: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: merchantRow, error: null }),
    single: vi.fn().mockResolvedValue({ data: merchantRow, error: null }),
    in: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({ data: productRows, error: null }),
    overrideTypes: vi
      .fn()
      .mockResolvedValue({ data: productRows, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: thenable mock
    then: (resolve: (value: unknown) => void) =>
      Promise.resolve().then(() => resolve({ data: [], error: null })),
  };
  const defaults: Record<string, RpcOutcome> = {
    create_storefront_order: {
      data: [
        {
          id: 'order-id',
          order_number: 'ORD-123',
          total: 1000,
          subtotal: 1000,
          shipping_fee: 0,
          customer_id: CUSTOMER_ID,
          tracking_token: 'track-default-1',
        },
      ],
      error: null,
    },
    redeem_wallet_for_order: { data: null, error: null },
    redeem_savings_for_order: { data: null, error: null },
    finalize_wallet_order_payment: { data: null, error: null },
    finalize_store_credit_order_payment: { data: null, error: null },
    has_storefront_order_idempotency_key: { data: false, error: null },
    get_order_variant_overrides: { data: [], error: null },
    get_checkout_shipping_quote: { data: null, error: null },
    persist_storefront_order_delivery_metadata: { data: false, error: null },
    claim_immediate_order_notification_with_proof: {
      data: [{ claimed: true, claim_status: 'processing', claim_token: 't' }],
      error: null,
    },
    complete_immediate_order_notification_with_proof: {
      data: null,
      error: null,
    },
    mark_immediate_order_notification_started_with_proof: {
      data: true,
      error: null,
    },
  };
  return {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => chainable),
    rpc: vi.fn(
      async (name: string) =>
        overrides[name] ??
        defaults[name] ?? {
          data: null,
          error: null,
        }
    ),
  };
}

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

export const LOYALTY_CODE_ROW = {
  redemption_id: '22222222-2222-4222-8222-222222222222',
  reward_type: 'discount_fixed',
  reward_value: 100,
  minimum_order_amount: null,
  minimum_known: true,
  expires_at: null,
  used: false,
  issuance_currency: 'NGN',
  max_redemption_percentage: null,
  reward_name: 'Probe reward',
};

export const PRODUCT_ROWS = [{ id: 'p-1', price: 1000 }];

export const orderRowWithDiscount = {
  id: 'order-id',
  order_number: 'ORD-123',
  total: 900,
  subtotal: 1000,
  discount_amount: 100,
};

export async function setupLoyaltyBridge(
  overrides: Record<string, RpcOutcome>
) {
  vi.clearAllMocks();
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
  const supabase = buildLoyaltyMockSupabase(overrides, PRODUCT_ROWS);
  const supabaseMod = await import('@/lib/supabase/server');
  vi.mocked(supabaseMod.createClient).mockImplementation(
    () => supabase as unknown as never
  );
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    user: {
      id: '123e4567-e89b-12d3-a456-426614174099',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    error: null,
    supabase: supabase as unknown as never,
  });
  return supabase;
}

export function loyaltyRequest(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'loyalty-bridge-test-key' },
    body: JSON.stringify({ ...baseOrderPayload, ...extra }),
  });
}

export function loyaltyRequestWithoutIdempotencyKey(
  extra: Record<string, unknown> = {}
) {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    body: JSON.stringify({ ...baseOrderPayload, ...extra }),
  });
}
