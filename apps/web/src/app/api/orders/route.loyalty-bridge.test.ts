import { describe, expect, it, vi } from 'vitest';
import {
  authenticateApiRequest,
  mockCreateAdminClient,
  NextRequest,
  POST,
} from './route.loyalty-bridge.mocks.test-support';

// Loyalty-checkout cases (issue #3165), split from oversized route.test.ts.
const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';

type RpcOutcome = { data: unknown; error: unknown };

function buildLoyaltyMockSupabase(
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

const baseOrderPayload = {
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

const LOYALTY_CODE_ROW = {
  redemption_id: '22222222-2222-4222-8222-222222222222',
  reward_type: 'discount_fixed',
  reward_value: 100,
  minimum_order_amount: null,
  expires_at: null,
  used: false,
  reward_name: 'Probe reward',
};

const PRODUCT_ROWS = [{ id: 'p-1', price: 1000 }];

const orderRowWithDiscount = {
  id: 'order-id',
  order_number: 'ORD-123',
  total: 900,
  subtotal: 1000,
  discount_amount: 100,
};

async function setupLoyaltyBridge(overrides: Record<string, RpcOutcome>) {
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

function loyaltyRequest(extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    body: JSON.stringify({ ...baseOrderPayload, ...extra }),
  });
}

describe('POST /api/orders loyalty-code bridge', () => {
  it('dispatches create_storefront_order_with_loyalty_code after a merchant-code miss', async () => {
    const supabase = await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: [orderRowWithDiscount],
        error: null,
      },
    });

    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );

    expect(response.status).toBeLessThan(400);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_loyalty_code',
      expect.objectContaining({
        p_loyalty_redemption_id: LOYALTY_CODE_ROW.redemption_id,
        p_discount_amount: 100,
      })
    );
  });

  it('maps loyalty_code_already_used to 409', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_code_already_used' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('loyalty_code_already_used');
  });

  it('maps loyalty_code_expired to 400', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_code_expired' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).details).toBe('loyalty_code_expired');
  });

  it('maps loyalty_reward_inactive to 400', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [LOYALTY_CODE_ROW],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: null,
        error: { message: 'loyalty_reward_inactive' },
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).details).toBe('loyalty_reward_inactive');
  });

  it('bridges a plain discount loyalty code with fixed semantics', async () => {
    const supabase = await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [
          { ...LOYALTY_CODE_ROW, reward_type: 'discount', reward_value: 100 },
        ],
        error: null,
      },
      create_storefront_order_with_loyalty_code: {
        data: [orderRowWithDiscount],
        error: null,
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBeLessThan(400);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order_with_loyalty_code',
      expect.objectContaining({ p_discount_amount: 100 })
    );
  });

  it('returns 400 discount_code_invalid for a non-discount loyalty type', async () => {
    await setupLoyaltyBridge({
      get_storefront_discount_code: { data: [], error: null },
      get_loyalty_redemption_for_checkout: {
        data: [
          {
            ...LOYALTY_CODE_ROW,
            reward_type: 'free_shipping',
            reward_value: null,
          },
        ],
        error: null,
      },
    });
    const response = await POST(
      loyaltyRequest({ discount_code: 'RDM-ABCDEF12' })
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('discount_code_invalid');
  });
});
