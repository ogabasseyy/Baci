import { describe, expect, it, vi } from 'vitest';
import { resolveVtuCustomer } from '@/lib/vtu-customer-resolution';

type ResolveCustomerSupabase = Parameters<
  typeof resolveVtuCustomer
>[0]['supabase'];

describe('resolveVtuCustomer', () => {
  const linkedCustomer = {
    email: 'customer@example.com',
    first_name: 'Ada',
    id: 'customer-1',
    last_name: 'Lovelace',
    phone: '08012345678',
    user_id: 'user-1',
  };

  function createResolveCustomerSupabase({
    byEmail = null,
    byUserId = null,
  }: {
    byEmail?: Record<string, unknown> | null;
    byUserId?: Record<string, unknown> | null;
  }) {
    const customerUpdateMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: 'customer-1' }, error: null });
    const customerUpdateSelect = vi.fn(() => ({
      maybeSingle: customerUpdateMaybeSingle,
    }));
    const customerUpdateIs = vi.fn(() => ({
      select: customerUpdateSelect,
    }));
    const customerUpdateEq = vi.fn(() => ({
      is: customerUpdateIs,
    }));
    const customerUpdate = vi.fn(() => ({
      eq: customerUpdateEq,
    }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          select: vi.fn(() => {
            const filters = new Map<string, unknown>();
            const builder = {
              eq: vi.fn((field: string, value: unknown) => {
                filters.set(field, value);
                return builder;
              }),
              maybeSingle: vi.fn(() => {
                if (filters.has('user_id')) {
                  return Promise.resolve({ data: byUserId, error: null });
                }

                return Promise.resolve({ data: byEmail, error: null });
              }),
            };
            return builder;
          }),
          update: customerUpdate,
        };
      }),
    } as unknown as ResolveCustomerSupabase;

    return { customerUpdate, customerUpdateEq, customerUpdateIs, supabase };
  }

  it('resolves a customer directly by user_id without relinking', async () => {
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byUserId: linkedCustomer,
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer?.id).toBe('customer-1');
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('links an email-matched guest customer before VTU checkout writes payment rows', async () => {
    const { customerUpdate, customerUpdateEq, customerUpdateIs, supabase } =
      createResolveCustomerSupabase({
        byEmail: {
          ...linkedCustomer,
          user_id: null,
        },
      });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer?.id).toBe('customer-1');
    expect(customer?.user_id).toBe('user-1');
    expect(customerUpdate).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(customerUpdateEq).toHaveBeenCalledWith('id', 'customer-1');
    expect(customerUpdateIs).toHaveBeenCalledWith('user_id', null);
  });

  it('returns an unlinked email match without linking in read-only mode', async () => {
    // Codex R86 P1: the replay path resolves ownership BEFORE the
    // guards run, so linking there would cause a privileged
    // customers.user_id write before a mismatched replay is
    // rejected. Read-only mode returns the row as-is (the guard
    // compares ids; linking is reserved for the fresh path).
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byEmail: {
        ...linkedCustomer,
        user_id: null,
      },
    });

    const customer = await resolveVtuCustomer({
      linkEmailMatch: false,
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer?.id).toBe('customer-1');
    expect(customer?.user_id).toBeNull();
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('does not relink an email-matched customer that already has a user_id', async () => {
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byEmail: linkedCustomer,
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer?.id).toBe('customer-1');
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('returns null when the email-matched customer belongs to a different user', async () => {
    // Tenant isolation: returning the row would let every caller
    // transact as another customer on an email claim alone. All
    // callers fail closed on null.
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byEmail: {
        ...linkedCustomer,
        user_id: 'user-2',
      },
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('returns null when no user_id or email customer exists', async () => {
    const { customerUpdate, supabase } = createResolveCustomerSupabase({});

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('returns null when user email is missing and user_id lookup fails', async () => {
    const { customerUpdate, supabase } = createResolveCustomerSupabase({});

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: undefined,
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('refuses to link an email match for an unverified session', async () => {
    // Muse R109 HIGH: an account carrying a victim's address (no
    // email_confirmed_at) must never first-claim their guest row —
    // no link write, no row returned, no DB lookup at all.
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byEmail: {
        ...linkedCustomer,
        user_id: null,
      },
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: null,
        id: 'user-1',
      } as unknown as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(customerUpdate).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('refuses a byUserId hit for an unverified session', async () => {
    // A row claimed before the verification gate must not stay
    // spendable: the gate covers the byUserId hit too, mirroring
    // resolvePrimaryWalletIdentity.
    const { supabase } = createResolveCustomerSupabase({
      byUserId: linkedCustomer,
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: undefined,
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('resolves a verified phone-only session by user_id', async () => {
    // Codex R116 P1: phone-auth storefront logins carry no email;
    // the session route links their customer row by user_id, so a
    // phone-confirmed session must reach the authoritative lookup.
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byUserId: { ...linkedCustomer, email: null },
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: undefined,
        email_confirmed_at: undefined,
        id: 'user-1',
        phone: '08012345678',
        phone_confirmed_at: '2026-01-01T00:00:00.000Z',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer?.id).toBe('customer-1');
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('refuses the email fallback for a phone session with an unverified address', async () => {
    // The email fallback needs a VERIFIED email: a phone-confirmed
    // session carrying an unverified address must not link or spend
    // as that address's guest row.
    const { customerUpdate, supabase } = createResolveCustomerSupabase({
      byEmail: {
        ...linkedCustomer,
        user_id: null,
      },
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: 'customer@example.com',
        email_confirmed_at: null,
        id: 'user-1',
        phone: '08012345678',
        phone_confirmed_at: '2026-01-01T00:00:00.000Z',
      } as unknown as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('refuses an unconfirmed phone session without any lookup', async () => {
    const { supabase } = createResolveCustomerSupabase({
      byUserId: linkedCustomer,
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: {
        email: undefined,
        id: 'user-1',
        phone: '08012345678',
        phone_confirmed_at: undefined,
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

describe('resolveVtuCustomer strictLookups', () => {
  function supabaseWithCustomerErrors({
    byEmailError = null,
    byUserIdError = null,
  }: {
    byEmailError?: { message: string } | null;
    byUserIdError?: { message: string } | null;
  }) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          const filters = new Map<string, unknown>();
          const builder = {
            eq: vi.fn((field: string, value: unknown) => {
              filters.set(field, value);
              return builder;
            }),
            maybeSingle: vi.fn(() => {
              if (filters.has('user_id')) {
                return Promise.resolve({ data: null, error: byUserIdError });
              }
              return Promise.resolve({ data: null, error: byEmailError });
            }),
          };
          return builder;
        }),
      })),
    } as unknown as ResolveCustomerSupabase;
  }

  const strictUser = {
    email: 'customer@example.com',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    id: 'user-1',
  } as Parameters<typeof resolveVtuCustomer>[0]['user'];

  it('throws on user_id lookup error when strict (500, key kept)', async () => {
    const supabase = supabaseWithCustomerErrors({
      byUserIdError: { message: 'connection reset' },
    });

    await expect(
      resolveVtuCustomer({
        merchantId: 'merchant-1',
        strictLookups: true,
        supabase,
        user: strictUser,
      })
    ).rejects.toThrow(/Failed to look up VTU customer/);
  });

  it('throws on email-fallback lookup error when strict', async () => {
    const supabase = supabaseWithCustomerErrors({
      byEmailError: { message: 'timeout' },
    });

    await expect(
      resolveVtuCustomer({
        merchantId: 'merchant-1',
        strictLookups: true,
        supabase,
        user: strictUser,
      })
    ).rejects.toThrow(/Failed to look up VTU customer/);
  });

  it('resolves null on lookup errors when not strict (legacy callers)', async () => {
    const supabase = supabaseWithCustomerErrors({
      byEmailError: { message: 'timeout' },
      byUserIdError: { message: 'connection reset' },
    });

    const customer = await resolveVtuCustomer({
      merchantId: 'merchant-1',
      supabase,
      user: strictUser,
    });

    expect(customer).toBeNull();
  });
});
