// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useCreateBranch,
  useDeactivateBranch,
  useUpdateBranch,
} from '@/hooks/useBranches';

const mocks = vi.hoisted(() => ({
  merchant: { id: 'merchant-1' } as { id: string } | null,
  createBranch: vi.fn(),
  deactivateBranch: vi.fn(),
  supabaseFrom: vi.fn(),
  directInsert: vi.fn(),
  directUpdate: vi.fn(),
  updateBranch: vi.fn(),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/lib/branch-api', () => ({
  createBranch: (...args: unknown[]) => mocks.createBranch(...args),
  deactivateBranch: (...args: unknown[]) => mocks.deactivateBranch(...args),
  updateBranch: (...args: unknown[]) => mocks.updateBranch(...args),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    getString: vi.fn(() => null),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mocks.supabaseFrom(table),
  },
}));

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

beforeEach(() => {
  mocks.merchant = { id: 'merchant-1' };
  mocks.createBranch.mockReset();
  mocks.deactivateBranch.mockReset();
  mocks.updateBranch.mockReset();
  mocks.supabaseFrom.mockReset();
  mocks.directInsert.mockReset();
  mocks.directUpdate.mockReset();
  mocks.supabaseFrom.mockImplementation((table: string) => {
    if (table === 'branches') {
      return {
        insert: mocks.directInsert,
        update: mocks.directUpdate,
      };
    }

    return {};
  });
  mocks.createBranch.mockResolvedValue({
    id: '123e4567-e89b-42d3-a456-426614174000',
    merchant_id: 'merchant-1',
    name: 'Lagos main',
    address: null,
    city: 'Lagos',
    state: null,
    phone: null,
    manager_id: null,
    is_default: true,
    active: true,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  });
  mocks.updateBranch.mockResolvedValue({
    id: '123e4567-e89b-42d3-a456-426614174000',
    merchant_id: 'merchant-1',
    name: 'Updated Lagos',
    address: null,
    city: 'Lagos',
    state: null,
    phone: null,
    manager_id: null,
    is_default: true,
    active: true,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  });
  mocks.deactivateBranch.mockResolvedValue(undefined);
});

describe('useCreateBranch', () => {
  it('creates branches through branch-api instead of direct Supabase writes', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateBranch(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: 'Lagos main',
        city: 'Lagos',
        isDefault: true,
      });
    });

    expect(mocks.createBranch).toHaveBeenCalledWith(
      {
        name: 'Lagos main',
        city: 'Lagos',
        isDefault: true,
      },
      'merchant-1'
    );
    expect(mocks.directInsert).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['branches'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['branch-scope'],
    });
  });

  it('fails fast when merchant context is missing', async () => {
    mocks.merchant = null;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateBranch(), {
      wrapper: Wrapper,
    });
    let thrownError: unknown = null;

    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'Lagos main' });
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('No merchant');
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.directInsert).not.toHaveBeenCalled();
  });

  it('fails fast when the selected merchant context is whitespace', async () => {
    mocks.merchant = { id: '  ' };
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateBranch(), {
      wrapper: Wrapper,
    });
    let thrownError: unknown = null;

    await act(async () => {
      try {
        await result.current.mutateAsync({ name: 'Lagos main' });
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('No merchant');
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.directInsert).not.toHaveBeenCalled();
  });
});

describe('useUpdateBranch', () => {
  it('updates branches through branch-api instead of direct Supabase writes', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateBranch(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        branchId: '123e4567-e89b-42d3-a456-426614174000',
        input: { name: 'Updated Lagos', city: 'Lagos' },
      });
    });

    expect(mocks.updateBranch).toHaveBeenCalledWith(
      '123e4567-e89b-42d3-a456-426614174000',
      { name: 'Updated Lagos', city: 'Lagos' }
    );
    expect(mocks.directUpdate).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['branches'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['branch-scope'],
    });
  });

  it('fails fast when merchant context is missing', async () => {
    mocks.merchant = null;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateBranch(), {
      wrapper: Wrapper,
    });
    let thrownError: unknown = null;

    await act(async () => {
      try {
        await result.current.mutateAsync({
          branchId: '123e4567-e89b-42d3-a456-426614174000',
          input: { name: 'Updated Lagos' },
        });
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('No merchant');
    expect(mocks.updateBranch).not.toHaveBeenCalled();
    expect(mocks.directUpdate).not.toHaveBeenCalled();
  });
});

describe('useDeactivateBranch', () => {
  it('deactivates branches through branch-api instead of direct Supabase writes', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeactivateBranch(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync('123e4567-e89b-42d3-a456-426614174000');
    });

    expect(mocks.deactivateBranch).toHaveBeenCalledWith(
      '123e4567-e89b-42d3-a456-426614174000'
    );
    expect(mocks.directUpdate).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['branches'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['branch-scope'],
    });
  });

  it('fails fast when merchant context is missing', async () => {
    mocks.merchant = null;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useDeactivateBranch(), {
      wrapper: Wrapper,
    });
    let thrownError: unknown = null;

    await act(async () => {
      try {
        await result.current.mutateAsync(
          '123e4567-e89b-42d3-a456-426614174000'
        );
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe('No merchant');
    expect(mocks.deactivateBranch).not.toHaveBeenCalled();
    expect(mocks.directUpdate).not.toHaveBeenCalled();
  });
});
