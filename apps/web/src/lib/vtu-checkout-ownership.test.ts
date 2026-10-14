import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRequestingOwnership } from './vtu-checkout-ownership';

const { mockResolveVtuCustomer } = vi.hoisted(() => ({
  mockResolveVtuCustomer: vi.fn(),
}));

vi.mock('@/lib/vtu-pending-transaction', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  resolveVtuCustomer: mockResolveVtuCustomer,
}));

// Alias behavior is covered through the route suite; unit tests pin
// the ownership contract with a passthrough.
vi.mock('@/lib/with-merchant-slug-alias-fallback', () => ({
  withMerchantSlugAliasFallback: (
    slug: string,
    lookup: (resolvedSlug: string) => Promise<unknown>
  ) => lookup(slug),
}));

describe('resolveRequestingOwnership', () => {
  const user = { id: 'user-1' } as Parameters<
    typeof resolveRequestingOwnership
  >[1];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildSupabase(merchant: { data: unknown; error: unknown }) {
    const maybeSingle = vi.fn().mockResolvedValue(merchant);
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { from, supabase: { from } as never };
  }

  it('resolves the merchant and the requesting customer', async () => {
    const { from, supabase } = buildSupabase({
      data: { id: 'merchant-1' },
      error: null,
    });
    mockResolveVtuCustomer.mockResolvedValue({ id: 'customer-1' });

    const result = await resolveRequestingOwnership(
      supabase,
      user,
      'ogabassey'
    );

    expect(result).toEqual({
      customerId: 'customer-1',
      merchantId: 'merchant-1',
    });
    expect(from).toHaveBeenCalledWith('merchants');
    // Codex R86 P1: replay ownership resolution is read-only —
    // linking here would write customers.user_id before the guards
    // reject a mismatched replay.
    expect(mockResolveVtuCustomer).toHaveBeenCalledWith({
      linkEmailMatch: false,
      merchantId: 'merchant-1',
      strictLookups: true,
      supabase,
      user,
    });
  });

  it('returns nulls when the merchant is not found', async () => {
    const { supabase } = buildSupabase({ data: null, error: null });

    const result = await resolveRequestingOwnership(supabase, user, 'unknown');

    expect(result).toEqual({ customerId: null, merchantId: null });
    expect(mockResolveVtuCustomer).not.toHaveBeenCalled();
  });

  it('throws (key kept) when the merchant lookup errors', async () => {
    const { supabase } = buildSupabase({
      data: null,
      error: { message: 'db down' },
    });

    await expect(
      resolveRequestingOwnership(supabase, user, 'ogabassey')
    ).rejects.toThrow('Failed to resolve VTU merchant ownership: db down');
    expect(mockResolveVtuCustomer).not.toHaveBeenCalled();
  });

  it('returns a null customer id when no customer row exists', async () => {
    const { supabase } = buildSupabase({
      data: { id: 'merchant-1' },
      error: null,
    });
    mockResolveVtuCustomer.mockResolvedValue(null);

    const result = await resolveRequestingOwnership(
      supabase,
      user,
      'ogabassey'
    );

    expect(result).toEqual({ customerId: null, merchantId: 'merchant-1' });
  });
});
