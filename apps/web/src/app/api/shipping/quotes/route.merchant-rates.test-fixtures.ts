import type { NextRequest } from 'next/server';
import { vi } from 'vitest';

export const mockCreateAdminClient = vi.fn();
export const mockCreateServerClient = vi.fn();
export const mockGetMerchantForApiRequest = vi.fn();
export const mockGetQuotes = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateServerClient,
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchantForApiRequest,
  toUserAccess: vi.fn((context: unknown) => context),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(() => true),
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getQuotes: mockGetQuotes,
  },
}));

export const ZONE_ID = '44444444-4444-4444-8444-444444444444';
export const RATE_ID = '55555555-5555-4555-8555-555555555555';
export const TIER_RATE_ID = '66666666-6666-4666-8666-666666666666';
export const GIGL_QUOTE_ID = '33333333-3333-4333-8333-333333333333';

export const EMPTY_RATES_PAYLOAD = { locations: [], rates: [], zones: [] };

export function buildRate(overrides: Record<string, unknown> = {}) {
  return {
    id: RATE_ID,
    zone_id: ZONE_ID,
    name: 'Standard Delivery',
    kind: 'ship',
    currency: 'NGN',
    base_amount: 1500,
    condition_type: 'always',
    min_subtotal: null,
    max_subtotal: null,
    free_over_amount: null,
    delivery_min_days: null,
    delivery_max_days: null,
    pickup_address: null,
    sort_order: 0,
    active: true,
    ...overrides,
  };
}

export const lagosRatesPayload = {
  zones: [
    { id: ZONE_ID, name: 'Lagos', is_rest_of_world: false, active: true },
  ],
  locations: [
    { zone_id: ZONE_ID, country_code: 'NG', subdivision_code: 'NG-LA' },
  ],
  rates: [buildRate()],
};

export const indiaRatesPayload = {
  zones: [
    { id: ZONE_ID, name: 'India', is_rest_of_world: false, active: true },
  ],
  locations: [{ zone_id: ZONE_ID, country_code: 'IN', subdivision_code: null }],
  rates: [buildRate({ currency: 'INR', base_amount: 200 })],
};

export const indiaTieredRatesPayload = {
  ...indiaRatesPayload,
  rates: [
    buildRate({
      id: TIER_RATE_ID,
      name: 'Small Order Delivery',
      currency: 'INR',
      base_amount: 100,
      condition_type: 'price_tier',
      min_subtotal: 0,
      max_subtotal: 50_000,
    }),
    buildRate({
      currency: 'INR',
      base_amount: 2000,
      free_over_amount: 50_000,
      sort_order: 1,
    }),
  ],
};

export const giglQuote = {
  id: GIGL_QUOTE_ID,
  provider: 'GIGL' as const,
  serviceTier: 'Standard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics',
  estimatedDays: 3,
  price: 5000,
  currency: 'NGN',
  pickupIncluded: true,
  insuranceIncluded: true,
  expiresAt: new Date(Date.now() + 60_000),
};

export interface SupabaseMockOptions {
  /** When true, the merchant-rate RPC resolves an error (a load failure). */
  rpcError?: boolean;
}

export function buildSupabaseMock(
  merchantDetails: Record<string, unknown>,
  ratesPayload: unknown = EMPTY_RATES_PAYLOAD,
  options: SupabaseMockOptions = {}
) {
  const shippingQuotesTable = {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  const merchantSelect = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: merchantDetails,
      error: null,
    }),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return { select: vi.fn(() => merchantSelect) };
      }
      if (table === 'shipping_quotes') {
        return shippingQuotesTable;
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: options.rpcError
      ? vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'rate rpc failed' },
        })
      : vi.fn().mockResolvedValue({ data: ratesPayload, error: null }),
    shippingQuotesTable,
  };
}

export function buildDomesticRequest(
  overrides: Record<string, unknown> = {}
): NextRequest {
  return new Request('https://usebaci.com/api/shipping/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shipmentType: 'domestic',
      receiver: {
        name: 'Jane Receiver',
        address: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
      },
      items: [{ name: 'Phone', quantity: 1, weight: 1, value: 100_000 }],
      ...overrides,
    }),
  }) as unknown as NextRequest;
}

// India destination for a capable client. `supports_merchant_rates: true`
// opts the request into merchant-configured rates, which are the only quote
// source for a non-NG merchant.
export const indiaReceiver = {
  name: 'Jane Receiver',
  address: '12 MG Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  country: 'India',
  countryCode: 'IN',
};

export const indiaReceiverOverride = {
  receiver: indiaReceiver,
  supports_merchant_rates: true,
};

export const NG_MERCHANT = {
  business_name: 'Merchant Store',
  business_address: '1 Merchant Road, Lagos',
  phone: '08012345678',
  country: 'NG',
  payout_currency: 'NGN',
};

export const IN_MERCHANT = {
  business_name: 'Mumbai Store',
  business_address: '1 MG Road, Mumbai',
  phone: '+919876543210',
  country: 'IN',
  payout_currency: 'INR',
};

export async function postQuotes(
  merchantDetails: Record<string, unknown>,
  ratesPayload: unknown,
  overrides: Record<string, unknown> = {},
  options: SupabaseMockOptions = {}
) {
  const supabase = buildSupabaseMock(merchantDetails, ratesPayload, options);
  mockCreateAdminClient.mockReturnValue(supabase);
  mockCreateServerClient.mockResolvedValue(supabase);
  const { POST } = await import('./route');

  const response = await POST(buildDomesticRequest(overrides));
  return { json: await response.json(), response, supabase };
}
