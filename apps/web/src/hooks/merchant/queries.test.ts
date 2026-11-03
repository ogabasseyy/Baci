import { describe, expect, it, vi } from 'vitest';
import {
  fetchMerchantBySlug,
  fetchPrimaryDomain,
  normalizeFeatureSettings,
} from './queries';

// Helper to build a mock Supabase query chain
function mockQueryChain(resolvedValue: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(resolvedValue),
    maybeSingle: vi.fn().mockResolvedValue(resolvedValue),
  };
}

function createMockSupabase(
  tableHandlers: Record<string, ReturnType<typeof mockQueryChain>>
) {
  return {
    from: vi.fn((table: string) => {
      return (
        tableHandlers[table] ?? mockQueryChain({ data: null, error: null })
      );
    }),
  } as any;
}

describe('normalizeFeatureSettings', () => {
  it('returns first element when given an array', () => {
    const result = normalizeFeatureSettings([
      { pay_on_delivery_enabled: true },
    ]);
    expect(result).toEqual({ pay_on_delivery_enabled: true });
  });

  it('returns the object when given a non-array', () => {
    const obj = { pay_on_delivery_enabled: false };
    expect(normalizeFeatureSettings(obj)).toBe(obj);
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeFeatureSettings(undefined)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(normalizeFeatureSettings([])).toBeUndefined();
  });
});

describe('fetchMerchantBySlug', () => {
  it('returns merchant data for valid slug', async () => {
    const merchantData = {
      id: 'merchant-1',
      user_id: 'user-1',
      business_name: 'Test Store',
      business_type: 'FASHION',
      slug: 'test-store',
      feature_settings: [{ pay_on_delivery_enabled: true }],
    };
    const supabase = createMockSupabase({
      merchants: mockQueryChain({ data: merchantData, error: null }),
    });

    const result = await fetchMerchantBySlug(supabase, 'test-store');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('merchant-1');
    // Feature settings should be normalized from array to object
    expect(result?.feature_settings).toEqual({
      pay_on_delivery_enabled: true,
    });
  });

  it('does not request trust, legal, or secret analytics fields in public slug lookups', async () => {
    const merchantsHandler = mockQueryChain({
      data: {
        id: 'merchant-1',
        business_name: 'Test Store',
        business_type: 'FASHION',
        slug: 'test-store',
        feature_settings: null,
      },
      error: null,
    });
    const supabase = createMockSupabase({
      merchants: merchantsHandler,
    });

    await fetchMerchantBySlug(supabase, 'test-store');

    const selectArg = merchantsHandler.select.mock.calls[0]?.[0] as string;
    expect(selectArg).toContain('support_email');
    expect(selectArg).not.toContain('merchant_feature_settings(*)');
    expect(selectArg).not.toContain('custom_settings');
    expect(selectArg).toContain('twitter_event_ids');
    expect(selectArg).not.toContain('custom_domain');
    expect(selectArg).not.toContain('legal_entity_name');
    expect(selectArg).not.toContain('registered_address');
    expect(selectArg).not.toContain('tax_identification_number');
    expect(selectArg).not.toContain('trust_profile');
    expect(selectArg).not.toContain('facebook_capi_token');
    expect(selectArg).not.toContain('ga4_api_secret');
    expect(selectArg).not.toContain('tiktok_access_token');
    expect(selectArg).not.toContain('snapchat_capi_token');
    expect(selectArg).not.toContain('nin');
    expect(selectArg).not.toContain('bvn');
    // S0-A: the anon column grant on public.merchants excludes this column, so
    // re-adding it here would make fetchMerchantBySlug fail closed (42501).
    expect(selectArg).not.toContain('google_product_sheet_url');
  });

  // S1 containment: every column below is REVOKED from both the `anon` and the
  // `authenticated` Postgres role. PostgREST rejects the WHOLE query with 42501
  // if a select names any of them, so re-adding one here fails the storefront
  // read closed. This module previously also carried a dead dashboard loader
  // whose selects listed these columns; it was deleted rather than repaired.
  it.each([
    'paystack_subaccount_code',
    'virtual_terminal_code',
    'stripe_customer_id',
    'stripe_subscription_id',
    'facebook_capi_token',
    'facebook_capi_access_token',
    'ga4_api_secret',
    'tiktok_access_token',
    'snapchat_capi_token',
    'google_product_sheet_url',
    'nin',
    'bvn',
    'cac_number',
    'firs_public_key',
    'firs_certificate',
    'firs_email',
    'firs_password_encrypted',
  ])('never selects the revoked column %s', async (revokedColumn) => {
    const merchantsHandler = mockQueryChain({
      data: { id: 'merchant-1' },
      error: null,
    });
    const supabase = createMockSupabase({ merchants: merchantsHandler });

    await fetchMerchantBySlug(supabase, 'test-store');

    const selectArg = merchantsHandler.select.mock.calls[0]?.[0] as string;
    expect(selectArg).not.toContain(revokedColumn);
  });

  it('returns null when merchant not found', async () => {
    const supabase = createMockSupabase({
      merchants: mockQueryChain({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      }),
    });

    const result = await fetchMerchantBySlug(supabase, 'nonexistent');
    expect(result).toBeNull();
  });

  it('throws on unexpected errors', async () => {
    const supabase = createMockSupabase({
      merchants: mockQueryChain({
        data: null,
        error: { code: 'PGRST500', message: 'Server error' },
      }),
    });

    await expect(fetchMerchantBySlug(supabase, 'test')).rejects.toEqual({
      code: 'PGRST500',
      message: 'Server error',
    });
  });
});

describe('fetchPrimaryDomain', () => {
  it('returns domain when found', async () => {
    const supabase = createMockSupabase({
      domains: mockQueryChain({
        data: { domain: 'store.example.com' },
        error: null,
      }),
    });

    const result = await fetchPrimaryDomain(supabase, 'merchant-1');
    expect(result).toBe('store.example.com');
  });

  it('returns null when no domain found', async () => {
    const supabase = createMockSupabase({
      domains: mockQueryChain({ data: null, error: null }),
    });

    const result = await fetchPrimaryDomain(supabase, 'merchant-1');
    expect(result).toBeNull();
  });
});
