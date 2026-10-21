import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVtuMerchant } from './vtu-merchant-lookup';

const { mockGetCurrentSlugForAlias, mockGetCurrentSlugForAliasStrict } =
  vi.hoisted(() => ({
    mockGetCurrentSlugForAlias: vi.fn(),
    mockGetCurrentSlugForAliasStrict: vi.fn(),
  }));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: mockGetCurrentSlugForAlias,
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
};

describe('resolveVtuMerchant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentSlugForAlias.mockResolvedValue(null);
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

  it('never selects the revoked payment-secret column', async () => {
    // paystack_subaccount_code is revoked from authenticated/anon
    // (S1 PR 2b column ACL): selecting it 42501s the RLS-bound
    // checkout, and no VTU caller consumes it (Phase 2, #3694).
    const select = vi.fn((_cols: string) => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: MERCHANT, error: null }),
      })),
    }));
    const supabase = {
      from: vi.fn(() => ({ select })),
    };

    await resolveVtuMerchant({
      merchantSlug: 'live-slug',
      supabase: supabase as never,
    });

    expect(select).toHaveBeenCalledWith('id, slug, business_name');
    expect(select.mock.calls[0]?.[0]).not.toContain('paystack_subaccount_code');
  });

  it('resolves a stale slug via the strict alias fallback', async () => {
    const supabase = supabaseWithMerchants({
      'old-slug': { data: null, error: null },
      'new-slug': { data: MERCHANT, error: null },
    });
    mockGetCurrentSlugForAliasStrict.mockResolvedValue('new-slug');

    const merchant = await resolveVtuMerchant({
      merchantSlug: 'old-slug',
      strictLookups: true,
      supabase: supabase as never,
    });

    expect(merchant).toEqual(MERCHANT);
    expect(mockGetCurrentSlugForAliasStrict).toHaveBeenCalledWith('old-slug');
  });

  it('resolves a stale slug via the lenient alias fallback in legacy mode', async () => {
    const supabase = supabaseWithMerchants({
      'old-slug': { data: null, error: null },
      'new-slug': { data: MERCHANT, error: null },
    });
    mockGetCurrentSlugForAlias.mockResolvedValue('new-slug');

    const merchant = await resolveVtuMerchant({
      merchantSlug: 'old-slug',
      supabase: supabase as never,
    });

    expect(merchant).toEqual(MERCHANT);
    expect(mockGetCurrentSlugForAlias).toHaveBeenCalledWith('old-slug');
    expect(mockGetCurrentSlugForAliasStrict).not.toHaveBeenCalled();
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
        strictLookups: true,
        supabase: supabase as never,
      })
    ).rejects.toThrow(/alias lookup failed/);
  });

  it('legacy mode keeps Merchant-not-found on alias failures', async () => {
    // Non-strict callers (legacy /api/vtu/purchase) must keep lenient
    // behavior: a transient alias-DB error surfaces as not-found,
    // never as a thrown alias-cache error (Codex R56 6rrhXx).
    const supabase = supabaseWithMerchants({});
    // The lenient cache swallows transient alias-DB errors into null;
    // legacy callers therefore see plain not-found (Codex R56 6rrhXx).
    mockGetCurrentSlugForAlias.mockResolvedValue(null);

    await expect(
      resolveVtuMerchant({
        merchantSlug: 'old-slug',
        supabase: supabase as never,
      })
    ).rejects.toThrow('Merchant not found');
    expect(mockGetCurrentSlugForAliasStrict).not.toHaveBeenCalled();
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
