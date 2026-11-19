import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensurePermission } from '@/lib/merchant-server';

const { mockGetUser, mockSupabase } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSupabase: { auth: { getUser: vi.fn() } } as {
    auth: { getUser: unknown };
  },
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: vi.fn(),
  MerchantAuthenticationRequiredError: class MerchantAuthenticationRequiredError extends Error {},
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

const { getStorefrontSearchReadiness } = await import(
  './get-storefront-search-readiness'
);

function setupSupabaseForMerchant(merchantData: Record<string, unknown>) {
  const createTerminal = (table: string) => {
    const result =
      table === 'merchants'
        ? { data: merchantData, error: null }
        : table === 'products' || table === 'categories'
          ? { data: [], count: 0, error: null }
          : { count: 0, error: null };
    const terminal = Object.assign(Promise.resolve(result), {
      eq: () => terminal,
      or: () => terminal,
      order: () => terminal,
      range: () => terminal,
      maybeSingle: () => terminal,
    });
    return terminal;
  };

  Object.assign(mockSupabase, {
    auth: { getUser: mockGetUser },
    from: (table: string) => ({
      select: () => createTerminal(table),
    }),
  });
}

describe('getStorefrontSearchReadiness trust policy', () => {
  beforeEach(() => {
    Object.assign(mockSupabase, { auth: { getUser: mockGetUser } });
    mockGetUser.mockReset();
    vi.mocked(ensurePermission).mockReset();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
  });

  it('recognizes Ogabassey approved trust policy when persisted trust_profile is empty', async () => {
    vi.mocked(ensurePermission).mockResolvedValue({
      merchant: { id: 'merchant-ogabassey' },
    } as never);
    setupSupabaseForMerchant({
      business_name: 'Ogabassey',
      is_published: true,
      slug: 'ogabassey',
      site_description: 'Store description',
      site_tagline: null,
      support_email: 'support@ogabassey.com',
      support_phone: null,
      trust_profile: {},
    });

    const readiness = await getStorefrontSearchReadiness('merchant-ogabassey');
    expect(
      readiness.improvements.some(
        (i) => i.code === 'missing_published_trust_policy'
      )
    ).toBe(false);
  });

  it('flags missing_published_trust_policy for standard merchants with empty trust profile', async () => {
    vi.mocked(ensurePermission).mockResolvedValue({
      merchant: { id: 'merchant-other' },
    } as never);
    setupSupabaseForMerchant({
      business_name: 'Other Store',
      is_published: true,
      slug: 'other-store',
      site_description: 'Store description',
      site_tagline: null,
      support_email: 'support@other.example',
      support_phone: null,
      trust_profile: {},
    });

    const readiness = await getStorefrontSearchReadiness('merchant-other');
    expect(
      readiness.improvements.some(
        (i) => i.code === 'missing_published_trust_policy'
      )
    ).toBe(true);
  });
});
