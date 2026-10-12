import { describe, expect, it, vi } from 'vitest';
import { linkVtuCustomerByEmail } from './vtu-customer-link';

describe('linkVtuCustomerByEmail', () => {
  const byEmail = {
    email: 'customer@example.com',
    first_name: 'Ada',
    id: 'customer-1',
    last_name: null,
    phone: null,
    user_id: null,
  };

  function createSupabase({
    linkData = { id: 'customer-1' },
    linkError = null,
  }: {
    linkData?: Record<string, unknown> | null;
    linkError?: { message: string } | null;
  } = {}) {
    const maybeSingle = vi.fn(() =>
      Promise.resolve({ data: linkData, error: linkError })
    );
    const select = vi.fn(() => ({ maybeSingle }));
    const is = vi.fn(() => ({ select }));
    const eq = vi.fn(() => ({ is }));
    const update = vi.fn(() => ({ eq }));
    const supabase = { from: vi.fn(() => ({ update })) };
    return { eq, is, maybeSingle, select, supabase, update };
  }

  it('links the row, confirms the write, and returns a fresh linked object', async () => {
    const { eq, is, select, supabase, update } = createSupabase();

    const customer = await linkVtuCustomerByEmail({
      byEmail,
      supabase: supabase as never,
      userId: 'user-1',
    });

    expect(supabase.from).toHaveBeenCalledWith('customers');
    expect(update).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(eq).toHaveBeenCalledWith('id', 'customer-1');
    expect(is).toHaveBeenCalledWith('user_id', null);
    expect(select).toHaveBeenCalledWith('id');
    expect(customer).toEqual({ ...byEmail, user_id: 'user-1' });
  });

  it('fails closed when a concurrent email claim wins the race', async () => {
    // The rival UPDATE lands first, so this claim's
    // .is('user_id', null) matches zero rows: the loser must not
    // transact as a row it no longer owns.
    for (const strictLookups of [false, true]) {
      const { is, supabase } = createSupabase({ linkData: null });

      const customer = await linkVtuCustomerByEmail({
        byEmail,
        strictLookups,
        supabase: supabase as never,
        userId: 'user-1',
      });

      expect(is).toHaveBeenCalledWith('user_id', null);
      expect(customer).toBeNull();
    }
  });

  it('returns null when the link write fails', async () => {
    const { supabase } = createSupabase({
      linkError: { message: 'boom' },
    });

    const customer = await linkVtuCustomerByEmail({
      byEmail,
      supabase: supabase as never,
      userId: 'user-1',
    });

    expect(customer).toBeNull();
  });

  it('throws when the link write fails under strict lookups', async () => {
    const { supabase } = createSupabase({
      linkError: { message: 'boom' },
    });

    await expect(
      linkVtuCustomerByEmail({
        byEmail,
        strictLookups: true,
        supabase: supabase as never,
        userId: 'user-1',
      })
    ).rejects.toThrow('Failed to look up VTU customer: boom');
  });

  it('returns null when the linked row vanishes mid-checkout', async () => {
    for (const strictLookups of [false, true]) {
      const { supabase } = createSupabase({ linkData: null });

      const customer = await linkVtuCustomerByEmail({
        byEmail,
        strictLookups,
        supabase: supabase as never,
        userId: 'user-1',
      });

      expect(customer).toBeNull();
    }
  });
});
