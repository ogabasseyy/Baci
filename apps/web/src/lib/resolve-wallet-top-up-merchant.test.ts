import { describe, expect, it, vi } from 'vitest';
import { resolveWalletTopUpMerchant } from '@/lib/resolve-wallet-top-up-merchant';

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn(async () => null),
}));

type Row = { id: string; slug: string };
type QueryError = { message: string };
type SupabaseTestDouble = Parameters<typeof resolveWalletTopUpMerchant>[0] & {
  calls: Array<{ column: string; value: string }>;
  selects: string[];
};

function makeSupabase({
  byId,
  bySlug,
  idError = null,
  slugError = null,
}: {
  byId: Row | null;
  bySlug: Row | null;
  idError?: QueryError | null;
  slugError?: QueryError | null;
}) {
  const calls: Array<{ column: string; value: string }> = [];
  const selects: string[] = [];
  const supabase = {
    calls,
    selects,
    from: vi.fn(() => ({
      select: vi.fn((columns: string) => {
        selects.push(columns);
        return {
          eq: vi.fn((column: string, value: string) => {
            calls.push({ column, value });
            return {
              maybeSingle: vi.fn(async () => ({
                data: column === 'id' ? byId : bySlug,
                error: column === 'id' ? idError : slugError,
              })),
            };
          }),
        };
      }),
    })),
  };
  return supabase as unknown as SupabaseTestDouble;
}

describe('resolveWalletTopUpMerchant', () => {
  it('returns the id match without attempting the slug lookup when both identifiers agree', async () => {
    const supabase = makeSupabase({
      byId: { id: 'm1', slug: 's1' },
      bySlug: null,
    });

    const result = await resolveWalletTopUpMerchant<Row>(
      supabase,
      { merchantId: 'm1', merchantSlug: 's1' },
      'id, slug'
    );

    expect(result).toEqual({ id: 'm1', slug: 's1' });
    expect(supabase.calls).toEqual([{ column: 'id', value: 'm1' }]);
  });

  it('selects slug for id lookups so mixed identifiers can be checked for consistency', async () => {
    const supabase = makeSupabase({
      byId: { id: 'm1', slug: 's1' },
      bySlug: null,
    });

    await resolveWalletTopUpMerchant<{ id: string }>(
      supabase,
      { merchantId: 'm1', merchantSlug: 's1' },
      'id'
    );

    expect(supabase.selects).toEqual(['id, slug']);
  });

  it('falls back to the slug merchant when merchantId resolves to a different slug', async () => {
    const supabase = makeSupabase({
      byId: { id: 'stale-id', slug: 'other-store' },
      bySlug: { id: 'm2', slug: 's2' },
    });

    const result = await resolveWalletTopUpMerchant<Row>(
      supabase,
      { merchantId: 'stale-id', merchantSlug: 's2' },
      'id, slug'
    );

    expect(result).toEqual({ id: 'm2', slug: 's2' });
    expect(supabase.calls).toEqual([
      { column: 'id', value: 'stale-id' },
      { column: 'slug', value: 's2' },
    ]);
  });

  it('keeps the id match when merchantSlug is stale and does not resolve', async () => {
    const supabase = makeSupabase({
      byId: { id: 'm1', slug: 'current-store' },
      bySlug: null,
    });

    const result = await resolveWalletTopUpMerchant<Row>(
      supabase,
      { merchantId: 'm1', merchantSlug: 'stale-store' },
      'id, slug'
    );

    expect(result).toEqual({ id: 'm1', slug: 'current-store' });
    expect(supabase.calls).toEqual([
      { column: 'id', value: 'm1' },
      { column: 'slug', value: 'stale-store' },
    ]);
  });

  it('falls back to slug when a stale merchantId misses', async () => {
    const supabase = makeSupabase({
      byId: null,
      bySlug: { id: 'm2', slug: 's2' },
    });

    const result = await resolveWalletTopUpMerchant<Row>(
      supabase,
      { merchantId: 'stale', merchantSlug: 's2' },
      'id, slug'
    );

    expect(result).toEqual({ id: 'm2', slug: 's2' });
    expect(supabase.calls).toEqual([
      { column: 'id', value: 'stale' },
      { column: 'slug', value: 's2' },
    ]);
  });

  it('resolves by slug when no merchantId is supplied', async () => {
    const supabase = makeSupabase({
      byId: null,
      bySlug: { id: 'm3', slug: 's3' },
    });

    const result = await resolveWalletTopUpMerchant<Row>(
      supabase,
      { merchantSlug: 's3' },
      'id, slug'
    );

    expect(result).toEqual({ id: 'm3', slug: 's3' });
    expect(supabase.calls).toEqual([{ column: 'slug', value: 's3' }]);
  });

  it('returns null when neither id nor slug resolves', async () => {
    const supabase = makeSupabase({ byId: null, bySlug: null });

    const result = await resolveWalletTopUpMerchant<Row>(
      supabase,
      { merchantId: 'stale', merchantSlug: 'also-stale' },
      'id, slug'
    );

    expect(result).toBeNull();
  });

  it('throws when the merchantId lookup fails', async () => {
    const supabase = makeSupabase({
      byId: null,
      bySlug: { id: 'm2', slug: 's2' },
      idError: { message: 'id lookup failed' },
    });

    await expect(
      resolveWalletTopUpMerchant<Row>(
        supabase,
        { merchantId: 'm1', merchantSlug: 's2' },
        'id, slug'
      )
    ).rejects.toThrow('id lookup failed');
  });

  it('throws when the merchantSlug fallback lookup fails', async () => {
    const supabase = makeSupabase({
      byId: null,
      bySlug: null,
      slugError: { message: 'slug lookup failed' },
    });

    await expect(
      resolveWalletTopUpMerchant<Row>(
        supabase,
        { merchantId: 'stale', merchantSlug: 's2' },
        'id, slug'
      )
    ).rejects.toThrow('slug lookup failed');
  });
});
