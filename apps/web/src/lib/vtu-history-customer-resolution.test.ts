import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHistoryMerchantCustomer } from './vtu-history-customer-resolution';

const { mockAliasFallback } = vi.hoisted(() => ({
  mockAliasFallback: vi.fn(
    (
      slug: string,
      lookup: (resolvedSlug: string) => Promise<unknown>,
      _opts?: unknown
    ) => lookup(slug)
  ),
}));

// Alias behavior is covered through the route suite; unit tests pin
// the resolution contract with a passthrough.
vi.mock('@/lib/with-merchant-slug-alias-fallback', () => ({
  withMerchantSlugAliasFallback: mockAliasFallback,
}));

type MaybeSingleResult = { data: unknown; error: unknown };

describe('resolveHistoryMerchantCustomer', () => {
  function buildSupabase(responses: MaybeSingleResult[]) {
    let cursor = 0;
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve(responses[cursor++] ?? { data: null, error: null })
    );
    const select = vi.fn(() => chain);
    const from = vi.fn(() => ({ select }));
    return { from, supabase: { from } as never };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the merchant and customer by auth user id', async () => {
    const { from, supabase } = buildSupabase([
      { data: { id: 'merchant-1' }, error: null },
      { data: { id: 'customer-1', user_id: 'user-1' }, error: null },
    ]);

    const result = await resolveHistoryMerchantCustomer({
      merchantSlug: 'ogabassey',
      supabase,
      // Verified (Muse R150 M2): unverified sessions resolve to
      // noCustomer before any customer lookup runs.
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      },
    });

    expect(result).toEqual({
      customerId: 'customer-1',
      kind: 'ok',
      merchantId: 'merchant-1',
    });
    expect(from).toHaveBeenCalledWith('merchants');
    expect(from).toHaveBeenCalledWith('customers');
    expect(mockAliasFallback).toHaveBeenCalledWith(
      'ogabassey',
      expect.any(Function),
      { strict: true }
    );
  });

  it('accepts an email-matched row already linked to the caller', async () => {
    const { supabase } = buildSupabase([
      { data: { id: 'merchant-1' }, error: null },
      { data: null, error: null },
      { data: { id: 'customer-9', user_id: 'user-1' }, error: null },
    ]);

    const result = await resolveHistoryMerchantCustomer({
      merchantSlug: 'ogabassey',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      },
    });

    expect(result).toEqual({
      customerId: 'customer-9',
      kind: 'ok',
      merchantId: 'merchant-1',
    });
  });

  it('resolves nothing for an unverified session even with a linked row (Muse R150 M2)', async () => {
    // Mirrors checkout's R109 gate: a row linked before R109 (or
    // through any unverified path) stays unreadable — the error
    // slotted for the byUserId lookup proves the query never runs.
    const { supabase } = buildSupabase([
      { data: { id: 'merchant-1' }, error: null },
      { data: null, error: { message: 'must not run' } },
    ]);

    const result = await resolveHistoryMerchantCustomer({
      merchantSlug: 'ogabassey',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: null,
        id: 'user-1',
      },
    });

    expect(result).toEqual({ kind: 'noCustomer' });
  });

  it('opens the lookup for a phone-verified session without email (Muse R150 M2)', async () => {
    // Phone-auth storefront logins carry no email (mirrors
    // checkout: verified phone opens the user_id lookup).
    const { supabase } = buildSupabase([
      { data: { id: 'merchant-1' }, error: null },
      { data: { id: 'customer-1', user_id: 'user-1' }, error: null },
    ]);

    const result = await resolveHistoryMerchantCustomer({
      merchantSlug: 'ogabassey',
      supabase,
      user: {
        id: 'user-1',
        phone: '+2348012345678',
        phone_confirmed_at: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(result).toEqual({
      customerId: 'customer-1',
      kind: 'ok',
      merchantId: 'merchant-1',
    });
  });

  it('never queries the email fallback for an unverified address', async () => {
    // Muse R119 MEDIUM: the email claim alone proves nothing. The
    // error slotted for the email lookup proves the query never
    // runs — a run would surface customerError instead.
    const { supabase } = buildSupabase([
      { data: { id: 'merchant-1' }, error: null },
      { data: null, error: null },
      { data: null, error: { message: 'must not run' } },
    ]);

    const result = await resolveHistoryMerchantCustomer({
      merchantSlug: 'ogabassey',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: null,
        id: 'user-1',
      },
    });

    expect(result).toEqual({ kind: 'noCustomer' });
  });

  it('returns noCustomer for mismatched, unlinked, or email-less callers', async () => {
    // Tenant isolation: the email claim alone never scopes history —
    // mismatched rows belong to someone else, unlinked rows must not
    // be claimed by a GET, and without an email there is no fallback.
    for (const byEmail of [
      { id: 'customer-9', user_id: 'user-2' },
      { id: 'customer-9', user_id: null },
      null,
    ]) {
      const { supabase } = buildSupabase([
        { data: { id: 'merchant-1' }, error: null },
        { data: null, error: null },
        { data: byEmail, error: null },
      ]);

      const result = await resolveHistoryMerchantCustomer({
        merchantSlug: 'ogabassey',
        supabase,
        // Verified: the fallback runs and the same-user rejection
        // is genuinely exercised (not vacuously gated).
        user: {
          email: 'customer@example.com',
          email_confirmed_at: '2026-01-01T00:00:00.000Z',
          id: 'user-1',
        },
      });

      expect(result).toEqual({ kind: 'noCustomer' });
    }

    const { supabase } = buildSupabase([
      { data: { id: 'merchant-1' }, error: null },
      { data: null, error: null },
    ]);
    await expect(
      resolveHistoryMerchantCustomer({
        merchantSlug: 'ogabassey',
        supabase,
        user: { email: null, id: 'user-1' },
      })
    ).resolves.toEqual({ kind: 'noCustomer' });
  });

  it('returns noMerchant when the slug resolves nowhere', async () => {
    const { supabase } = buildSupabase([{ data: null, error: null }]);

    const result = await resolveHistoryMerchantCustomer({
      merchantSlug: 'unknown',
      supabase,
      user: { email: 'customer@example.com', id: 'user-1' },
    });

    expect(result).toEqual({ kind: 'noMerchant' });
  });

  it('returns merchantError (logged) when the merchant lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { supabase } = buildSupabase([
        { data: null, error: { message: 'db down' } },
      ]);

      const result = await resolveHistoryMerchantCustomer({
        merchantSlug: 'ogabassey',
        supabase,
        user: { email: 'customer@example.com', id: 'user-1' },
      });

      expect(result).toEqual({ kind: 'merchantError' });
      expect(error).toHaveBeenCalledWith(
        'Failed to resolve VTU history merchant:',
        { message: 'db down' }
      );
    } finally {
      error.mockRestore();
    }
  });
});
