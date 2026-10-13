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
        id: 'user-1',
      } as Parameters<typeof resolveVtuCustomer>[0]['user'],
    });

    expect(customer?.id).toBe('customer-1');
    expect(customer?.user_id).toBe('user-1');
    expect(customerUpdate).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(customerUpdateEq).toHaveBeenCalledWith('id', 'customer-1');
    expect(customerUpdateIs).toHaveBeenCalledWith('user_id', null);
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
