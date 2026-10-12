import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVtuMerchant } from './vtu-merchant-lookup';

const { mockGetCurrentSlugForAliasStrict } = vi.hoisted(() => ({
  mockGetCurrentSlugForAliasStrict: vi.fn(),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
  getCurrentSlugForAliasStrict: mockGetCurrentSlugForAliasStrict,
}));

function supabaseWithMerchants(
  bySlug: Record<string, { data: unknown; error: unknown }>
) {
  return {
    from: vi.fn((table: string) => {
      if (table !== 'merchants') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_field: string, value: string) => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue(bySlug[value] ?? { data: null, error: null }),
          })),
        })),
      };
    }),
  };
}

const MERCHANT = {
  id: 'merchant-1',
  slug: 'new-slug',
  business_name: 'Ogabassey',
  paystack_subaccount_code: null,
};

describe('resolveVtuMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSlugForAliasStrict.mockResolvedValue(null);
  });

  it('resolves a live slug without consulting aliases', async () => {
    const supabase = supabaseWithMerchants({
      'live-slug': { data: MERCHANT, error: null },
    });

    const merchant = await resolveVtuMerchant({
      merchantSlug: 'live-slug',
      supabase: supabase as never,
    });

    expect(merchant).toEqual(MERCHANT);
    expect(mockGetCurrentSlugForAliasStrict).not.toHaveBeenCalled();
  });

  it('resolves a stale slug via the strict alias fallback', async () => {
    const supabase = supabaseWithMerchants({
      'old-slug': { data: null, error: null },
      'new-slug': { data: MERCHANT, error: null },
    });
    mockGetCurrentSlugForAliasStrict.mockResolvedValue('new-slug');

    const merchant = await resolveVtuMerchant({
      merchantSlug: 'old-slug',
      supabase: supabase as never,
    });

    expect(merchant).toEqual(MERCHANT);
    expect(mockGetCurrentSlugForAliasStrict).toHaveBeenCalledWith('old-slug');
  });

  it('throws Merchant-not-found for unknown slugs', async () => {
    const supabase = supabaseWithMerchants({});

    await expect(
      resolveVtuMerchant({
        merchantSlug: 'nope',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Merchant not found');
  });

  it('throws the alias failure instead of Merchant-not-found', async () => {
    const supabase = supabaseWithMerchants({});
    mockGetCurrentSlugForAliasStrict.mockRejectedValue(
      new Error('[Slug Alias Cache] alias lookup failed for slug: old-slug')
    );

    await expect(
      resolveVtuMerchant({
        merchantSlug: 'old-slug',
        supabase: supabase as never,
      })
    ).rejects.toThrow(/alias lookup failed/);
  });

  it('strict lookups throw on transient merchant errors', async () => {
    const supabase = supabaseWithMerchants({
      ogabassey: { data: null, error: { message: 'connection reset' } },
    });

    await expect(
      resolveVtuMerchant({
        merchantSlug: 'ogabassey',
        strictLookups: true,
        supabase: supabase as never,
      })
    ).rejects.toThrow(/Failed to resolve VTU merchant/);
  });

  it('legacy mode keeps Merchant-not-found on merchant errors', async () => {
    const supabase = supabaseWithMerchants({
      ogabassey: { data: null, error: { message: 'connection reset' } },
    });

    await expect(
      resolveVtuMerchant({
        merchantSlug: 'ogabassey',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Merchant not found');
  });
});
