import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomer, useUpdateCustomer } from '@/hooks/useCustomers';

const mocks = vi.hoisted(() => ({
  eqCalls: [] as Array<{ column: string; table: string; value: unknown }>,
  from: vi.fn(),
  maybeSingleResponses: [] as Array<{
    data: unknown;
    error: { message: string } | null;
  }>,
  updatePayloads: [] as unknown[],
  merchant: { id: 'merchant-a' } as { id: string } | null,
}));

vi.mock('@baci/shared', () => ({
  buildCustomerRecordNameFields: vi.fn(() => ({})),
  buildCustomerSearchFilter: vi.fn(() => ''),
  CUSTOMER_ADMIN_COLUMNS: 'id, merchant_id, full_name',
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeSearchQuery: (value: string) => value.trim(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mocks.from(table);

      const query: Record<string, unknown> = {};
      query.select = vi.fn(() => query);
      query.eq = vi.fn((column: string, value: unknown) => {
        mocks.eqCalls.push({ column, table, value });
        return query;
      });
      query.update = vi.fn((payload: unknown) => {
        mocks.updatePayloads.push(payload);
        return query;
      });
      query.maybeSingle = vi.fn(async () => {
        return (
          mocks.maybeSingleResponses.shift() ?? {
            data: null,
            error: null,
          }
        );
      });
      query.order = vi.fn(() => query);
      query.limit = vi.fn(() => query);
      query.single = vi.fn(async () => ({
        data: {
          id: 'customer-1',
          merchant_id: mocks.merchant?.id ?? null,
          full_name: 'Ada Customer',
        },
        error: null,
      }));

      return query;
    },
  },
}));

function resetQueryTrackers() {
  vi.clearAllMocks();
  mocks.eqCalls = [];
  mocks.maybeSingleResponses = [];
  mocks.updatePayloads = [];
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

describe('useCustomer', () => {
  beforeEach(() => {
    resetQueryTrackers();
  });

  it('keys cached customer details by merchant so stale data is not reused across merchant switches', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const { rerender, result } = renderHook(() => useCustomer('customer-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.eqCalls).toContainEqual({
      column: 'merchant_id',
      table: 'customers',
      value: 'merchant-a',
    });
    expect(
      queryClient.getQueryCache().find({
        queryKey: ['customer', 'customer-1', 'merchant-a'],
      })
    ).toBeDefined();

    mocks.eqCalls = [];
    mocks.merchant = { id: 'merchant-b' };
    rerender();

    await waitFor(() =>
      expect(mocks.eqCalls).toContainEqual({
        column: 'merchant_id',
        table: 'customers',
        value: 'merchant-b',
      })
    );
    expect(
      queryClient.getQueryCache().find({
        queryKey: ['customer', 'customer-1', 'merchant-b'],
      })
    ).toBeDefined();
  });
});

describe('useUpdateCustomer', () => {
  beforeEach(() => {
    resetQueryTrackers();
  });

  it('clears stale locality and geocoding when the address changes without replacements', async () => {
    mocks.maybeSingleResponses.push({
      data: {
        address: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        zip_code: '100001',
        country: 'Nigeria',
        country_code: 'NG',
        latitude: 6.6018,
        longitude: 3.3515,
      },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      id: 'customer-1',
      customer_type: 'individual',
      first_name: 'Ada',
      last_name: 'Customer',
      email: 'ada@example.com',
      address: '99 Broad Street',
    });

    expect(mocks.updatePayloads[0]).toMatchObject({
      address: '99 Broad Street',
      city: null,
      state: null,
      zip_code: null,
      country: null,
      country_code: null,
      latitude: null,
      longitude: null,
    });
  });

  it('keeps locality when the address text is unchanged', async () => {
    mocks.maybeSingleResponses.push({
      data: {
        address: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        zip_code: '100001',
        country: 'Nigeria',
        country_code: 'NG',
        latitude: 6.6018,
        longitude: 3.3515,
      },
      error: null,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync({
      id: 'customer-1',
      customer_type: 'individual',
      first_name: 'Ada',
      last_name: 'Customer',
      email: 'ada@example.com',
      address: '12 Allen Avenue',
    });

    expect(mocks.updatePayloads[0]).toMatchObject({
      address: '12 Allen Avenue',
    });
    expect(mocks.updatePayloads[0]).not.toHaveProperty('city');
    expect(mocks.updatePayloads[0]).not.toHaveProperty('latitude');
  });
});
