import { vi } from 'vitest';
import { buildMockSupabase } from './shipping-route.test-fixtures';
import { mockCreateAdminClient } from './shipping-route.test-support';

const LAGOS_ZONE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROW_ZONE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const LAGOS_RATE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Raw snake_case payload, exactly as the get_storefront_shipping_rates RPC
// returns it (verifyOrderShippingRate parses it through the Zod schema).
export function shippingRatesRpcPayload(
  rateOverrides: Record<string, unknown> = {}
) {
  return {
    zones: [
      {
        id: LAGOS_ZONE_ID,
        name: 'Lagos',
        is_rest_of_world: false,
        active: true,
      },
      {
        id: ROW_ZONE_ID,
        name: 'Everywhere else',
        is_rest_of_world: true,
        active: true,
      },
    ],
    locations: [
      {
        zone_id: LAGOS_ZONE_ID,
        country_code: 'NG',
        subdivision_code: 'NG-LA',
      },
    ],
    rates: [
      {
        id: LAGOS_RATE_ID,
        zone_id: LAGOS_ZONE_ID,
        name: 'Lagos Standard',
        kind: 'ship',
        currency: 'NGN',
        base_amount: 1500,
        condition_type: 'always',
        min_subtotal: null,
        max_subtotal: null,
        free_over_amount: null,
        delivery_min_days: 1,
        delivery_max_days: 3,
        pickup_address: null,
        sort_order: 0,
        active: true,
        ...rateOverrides,
      },
    ],
  };
}

// Extends primeAdminOrderCurrencyRead's shape with the rates RPC and the
// post-create shipping_provider stamp (update().eq().eq()).
export function primeAdminShippingRateClient(
  ratesPayload: unknown,
  options: { ratesError?: unknown } = {}
) {
  const updateEqSecond = vi.fn().mockResolvedValue({ error: null });
  const updateEqFirst = vi.fn(() => ({ eq: updateEqSecond }));
  const update = vi.fn(() => ({ eq: updateEqFirst }));
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === 'get_storefront_shipping_rates'
        ? {
            data: options.ratesError ? null : ratesPayload,
            error: options.ratesError ?? null,
          }
        : { data: null, error: null }
    )
  );
  mockCreateAdminClient.mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'existing-order', currency: 'NGN' },
        error: null,
      }),
      update,
    })),
    rpc,
  } as never);
  return { rpc, update, updateEqFirst, updateEqSecond };
}

export async function primeStorefrontClient() {
  const supabaseMod = await import('@/lib/supabase/server');
  const supabase = buildMockSupabase(
    {},
    {
      // Catalog price matches the client line price (1000), so the
      // canonical subtotal for tier/free-over checks is 1000.
      productRows: [{ id: 'p-1', name: 'Widget', price: 1000, slug: 'widget' }],
    }
  );
  vi.mocked(supabaseMod.createClient).mockImplementation(
    () => supabase as unknown as never
  );
  return supabase;
}
