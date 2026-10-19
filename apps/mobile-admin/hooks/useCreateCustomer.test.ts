import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateCustomer } from './useCreateCustomer';

const mocks = vi.hoisted(() => ({
  eqCalls: [] as Array<{ column: string; table: string; value: unknown }>,
  from: vi.fn(),
  ilikeCalls: [] as Array<{ column: string; table: string; value: string }>,
  insertRows: [] as unknown[],
  limitResponses: {} as Record<
    string,
    {
      data: unknown[] | null;
      error: { message: string } | null;
    }
  >,
  nextInsertResponse: null as {
    data: unknown;
    error: { code?: string; message: string } | null;
  } | null,
  orCalls: [] as string[],
  merchant: { id: 'merchant-a' } as { id: string } | null,
}));

vi.mock('@baci/shared', () => ({
  buildCustomerAddressLine: vi.fn(() => null),
  buildCustomerRecordNameFields: vi.fn(() => ({
    customer_type: 'individual',
    full_name: 'David Chimezie',
  })),
  CUSTOMER_ADMIN_COLUMNS: 'id, merchant_id, full_name',
}));

vi.mock('./useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeEmail: (value: string) => value.toLowerCase().trim(),
  sanitizePhone: (value: string) => value.trim(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mocks.from(table);

      let limitLookupKey = '';
      const query: Record<string, unknown> = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn((column: string, value: unknown) => {
        mocks.eqCalls.push({ column, table, value });
        if (column === 'phone') {
          limitLookupKey = `${table}:${column}:${String(value)}`;
        }
        return query;
      });
      query.ilike = vi.fn((column: string, value: string) => {
        mocks.ilikeCalls.push({ column, table, value });
        limitLookupKey = `${table}:${column}:${value}`;
        return query;
      });
      query.insert = vi.fn((row: unknown) => {
        mocks.insertRows.push(row);
        return query;
      });
      query.is = vi.fn(() => query);
      query.single = vi.fn(() => {
        if (mocks.nextInsertResponse) {
          return mocks.nextInsertResponse;
        }

        return {
          data: {
            id: 'customer-1',
            merchant_id: mocks.merchant?.id ?? null,
            full_name: 'David Chimezie',
          },
          error: null,
        };
      });
      query.limit = vi.fn(() => {
        return (
          mocks.limitResponses[limitLookupKey] ?? {
            data: [],
            error: null,
          }
        );
      });

      return query;
    },
  },
}));

function resetQueryTrackers() {
  vi.clearAllMocks();
  mocks.eqCalls = [];
  mocks.ilikeCalls = [];
  mocks.insertRows = [];
  mocks.limitResponses = {};
  mocks.nextInsertResponse = null;
  mocks.orCalls = [];
  mocks.merchant = { id: 'merchant-a' };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  }

  return { queryClient, Wrapper };
}

describe('useCreateCustomer', () => {
  beforeEach(() => {
    resetQueryTrackers();
  });

  it('throws when merchant context is missing', async () => {
    mocks.merchant = null;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: Wrapper,
    });

    await expect(
      result.current.mutateAsync({
        customer_type: 'individual',
        first_name: 'David',
        last_name: 'Chimezie',
      })
    ).rejects.toThrow('No merchant selected');
  });

  it('normalizes customer email before duplicate lookup and insert', async () => {
    const { Wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      customer_type: 'individual',
      email: ' DavidChimezie2018@GMAIL.COM ',
      first_name: 'David',
      last_name: 'Chimezie',
      phone: ' 08062712682 ',
      city: 'Ikeja',
      state: 'Lagos',
      latitude: 6.6018,
      longitude: 3.3515,
    });

    expect(mocks.orCalls).toEqual([]);
    expect(mocks.eqCalls).toContainEqual({
      column: 'phone',
      table: 'customers',
      value: '08062712682',
    });
    expect(mocks.ilikeCalls).toContainEqual({
      column: 'email',
      table: 'customers',
      value: 'davidchimezie2018@gmail.com',
    });
    expect(mocks.insertRows[0]).toMatchObject({
      email: 'davidchimezie2018@gmail.com',
      merchant_id: 'merchant-a',
      phone: '08062712682',
      city: 'Ikeja',
      state: 'Lagos',
      latitude: 6.6018,
      longitude: 3.3515,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['customers'] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['customer-stats'],
    });
  });

  it('rejects before insert when a normalized email matches an existing customer', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: Wrapper,
    });

    mocks.limitResponses['customers:email:davidchimezie2018@gmail.com'] = {
      data: [{ id: 'customer-1' }],
      error: null,
    };

    await expect(
      result.current.mutateAsync({
        customer_type: 'individual',
        email: ' DavidChimezie2018@GMAIL.COM ',
        first_name: 'David',
        last_name: 'Chimezie',
        phone: '08062712682',
      })
    ).rejects.toThrow('Customer with this email or phone already exists');

    expect(mocks.ilikeCalls).toContainEqual({
      column: 'email',
      table: 'customers',
      value: 'davidchimezie2018@gmail.com',
    });
    expect(mocks.insertRows).toEqual([]);
  });

  it.each([
    'customers_merchant_id_email_key',
    'customers_merchant_email_unique',
    'idx_customers_merchant_email',
    'customers_merchant_phone_unique',
  ])('maps %s errors to the duplicate customer message', async (constraintName) => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: Wrapper,
    });

    mocks.nextInsertResponse = {
      data: null,
      error: {
        code: '23505',
        message: `duplicate key value violates unique constraint "${constraintName}"`,
      },
    };

    await expect(
      result.current.mutateAsync({
        customer_type: 'individual',
        email: 'DavidChimezie2018@gmail.com',
        first_name: 'David',
        last_name: 'Chimezie',
        phone: '08062712682',
      })
    ).rejects.toThrow('Customer with this email or phone already exists');
  });
});
