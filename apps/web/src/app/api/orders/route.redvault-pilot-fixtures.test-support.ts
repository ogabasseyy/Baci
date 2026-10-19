import { vi } from 'vitest';
import { mockCreateAdminClient } from './route.order-test-mocks.test-support';

export const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
export const CUSTOMER_ID = '11111111-2222-3333-4444-555555555555';

export function mockAuthUser(id: string) {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
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
  shipping_address: {
    address: '123 Test St',
    city: 'Lagos',
    state: 'Lagos',
  },
};

export function primeAdminOrderCurrencyRead(currency: string | null = 'NGN') {
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: currency ? { currency } : null,
        error: null,
      }),
    })),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  } as never);
}

type PilotProductRow = {
  id: string;
  name?: string | null;
  price: number;
  slug?: string | null;
  vat_category_code?: string | null;
  vat_rate?: number | null;
};

// Lean request-scoped Supabase double for the pilot suites: the generic
// chainable serves the merchant fixture (with VAT-registration status)
// and the product catalog through both the legacy `.returns()` and the
// modern `.overrideTypes()` idioms; every RPC resolves a null default
// while recording calls for the not-created assertions.
export function buildPilotMockSupabase(
  opts: {
    productRows?: PilotProductRow[];
    merchantVatRegistrationStatus?: string | null;
  } = {}
) {
  const merchantRow = {
    id: MERCHANT_ID,
    business_name: 'Test Merchant',
    country: 'NG',
    slug: 'test-merchant',
    support_email: 'support@example.com',
    email_sender_name: 'Test Store',
    email: 'merchant@example.com',
    vat_registration_status: opts.merchantVatRegistrationStatus ?? null,
  };
  const catalog = opts.productRows ?? [];
  const sharedChainable: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: merchantRow, error: null }),
    single: vi.fn().mockResolvedValue({ data: merchantRow, error: null }),
    in: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({ data: catalog, error: null }),
    overrideTypes: vi.fn().mockResolvedValue({ data: catalog, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: thenable mock
    then: (resolve: (value?: unknown) => void) =>
      Promise.resolve().then(resolve),
  };
  return {
    auth: { getUser: vi.fn() },
    from: vi.fn(() => sharedChainable),
    rpc: vi.fn(async (..._args: unknown[]) => ({
      data: null,
      error: null,
    })),
  };
}
