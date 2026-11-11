// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBranchScopeStorageKey,
  useBranchScope,
} from '@/hooks/useBranchScope';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const staleUuid = '123e4567-e89b-42d3-a456-426614174001';

const mocks = vi.hoisted(() => {
  const storageValues = new Map<string, string>();

  return {
    branches: [{ id: '123e4567-e89b-42d3-a456-426614174000', active: true }],
    branchesLoaded: true,
    merchant: { id: 'merchant-1' } as { id: string } | null,
    user: { id: 'user-1' } as { id: string } | null,
    storageValues,
    storageGetString: vi.fn((key: string) => storageValues.get(key)),
    storageSet: vi.fn((key: string, value: string) => {
      storageValues.set(key, value);
    }),
    storageRemove: vi.fn((key: string) => {
      storageValues.delete(key);
    }),
  };
});

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({
    data: mocks.branches,
    isSuccess: mocks.branchesLoaded,
  }),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    getString: (key: string) => mocks.storageGetString(key),
    set: (key: string, value: string) => mocks.storageSet(key, value),
    remove: (key: string) => mocks.storageRemove(key),
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

describe('useBranchScope', () => {
  beforeEach(() => {
    mocks.branches = [{ id: uuid, active: true }];
    mocks.branchesLoaded = true;
    mocks.merchant = { id: 'merchant-1' };
    mocks.user = { id: 'user-1' };
    mocks.storageValues.clear();
    mocks.storageGetString.mockClear();
    mocks.storageSet.mockClear();
    mocks.storageRemove.mockClear();
  });

  it('uses a merchant and user scoped storage key', () => {
    expect(getBranchScopeStorageKey('merchant-1', 'user-1')).toBe(
      'branch-scope:merchant-1:user-1'
    );
  });

  it('defaults to all locations when no branch is persisted', () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    expect(result.current.scope).toEqual({ type: 'all' });
    expect(result.current.branchId).toBeNull();
    expect(result.current.isAllLocations).toBe(true);
  });

  it('defaults to all locations without storage access when merchant is missing', () => {
    mocks.merchant = null;
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    expect(result.current.scope).toEqual({ type: 'all' });
    expect(result.current.branchId).toBeNull();
    expect(mocks.storageGetString).not.toHaveBeenCalled();
    expect(mocks.storageSet).not.toHaveBeenCalled();
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it('ignores branch scope updates when merchant is missing', () => {
    mocks.merchant = null;
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    act(() => {
      result.current.setBranchId(uuid);
    });

    expect(result.current.scope).toEqual({ type: 'all' });
    expect(mocks.storageSet).not.toHaveBeenCalled();
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it('defaults to all locations when user is missing', () => {
    mocks.user = null;
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    expect(result.current.scope).toEqual({ type: 'all' });
    expect(result.current.branchId).toBeNull();
    expect(mocks.storageGetString).not.toHaveBeenCalled();
    expect(mocks.storageSet).not.toHaveBeenCalled();
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it('loads a persisted concrete branch scope', () => {
    const key = getBranchScopeStorageKey('merchant-1', 'user-1');
    mocks.storageValues.set(key, uuid);
    mocks.branches = [
      { id: uuid, active: true },
      { id: staleUuid, active: true },
    ];
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    expect(result.current.scope).toEqual({ type: 'branch', branchId: uuid });
    expect(result.current.branchId).toBe(uuid);
  });

  it('clears a concrete branch scope when only one active branch exists', async () => {
    const key = getBranchScopeStorageKey('merchant-1', 'user-1');
    mocks.storageValues.set(key, uuid);
    mocks.branches = [{ id: uuid, active: true }];
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.scope).toEqual({ type: 'all' });
    });
    expect(mocks.storageRemove).toHaveBeenCalledWith(key);
  });

  it('clears a persisted concrete branch scope when the branch is not in the current list', async () => {
    const key = getBranchScopeStorageKey('merchant-1', 'user-1');
    mocks.storageValues.set(key, staleUuid);
    mocks.branches = [{ id: uuid, active: true }];
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.scope).toEqual({ type: 'all' });
    });
    expect(mocks.storageRemove).toHaveBeenCalledWith(key);
  });

  it('clears a persisted concrete branch scope when the branch is inactive', async () => {
    const key = getBranchScopeStorageKey('merchant-1', 'user-1');
    mocks.storageValues.set(key, staleUuid);
    mocks.branches = [{ id: staleUuid, active: false }];
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.scope).toEqual({ type: 'all' });
    });
    expect(mocks.storageRemove).toHaveBeenCalledWith(key);
  });

  it('persists branch scope updates', async () => {
    mocks.branches = [
      { id: uuid, active: true },
      { id: staleUuid, active: true },
    ];
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });
    const key = getBranchScopeStorageKey('merchant-1', 'user-1');

    act(() => {
      result.current.setBranchId(uuid);
    });

    expect(mocks.storageSet).toHaveBeenCalledWith(key, uuid);
    await waitFor(() => {
      expect(result.current.scope).toEqual({ type: 'branch', branchId: uuid });
    });
  });

  it('removes persisted state when switching back to all locations', async () => {
    const key = getBranchScopeStorageKey('merchant-1', 'user-1');
    mocks.storageValues.set(key, uuid);
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    act(() => {
      result.current.setAllLocations();
    });

    expect(mocks.storageRemove).toHaveBeenCalledWith(key);
    await waitFor(() => {
      expect(result.current.scope).toEqual({ type: 'all' });
    });
  });

  it('does not leak another merchant persisted branch into the current merchant', () => {
    mocks.storageValues.set(
      getBranchScopeStorageKey('other-merchant', 'user-1'),
      uuid
    );
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useBranchScope(), { wrapper: Wrapper });

    expect(result.current.scope).toEqual({ type: 'all' });
  });
});
