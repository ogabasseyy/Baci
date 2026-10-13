import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpenseAccess } from './useExpenseAccess';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const otherMerchantId = '8195ad88-0a9f-42ba-a18f-0db9ae9fc012';

const mocks = vi.hoisted(() => ({
  auth: { isLoading: false, user: { id: 'user-1' } as { id: string } | null },
  merchant: {
    merchant: {
      id: '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e',
    } as { id: string } | null,
    isLoading: false,
  },
  rpc: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mocks.auth,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => mocks.merchant,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mocks.rpc(...args) },
}));

function accessRow(permissions: unknown) {
  return {
    is_owner: false,
    is_staff: true,
    merchant_id: merchantId,
    permissions,
    role: 'accountant',
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function createDeferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve: (value: T) => resolve(value) };
}

describe('useExpenseAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { isLoading: false, user: { id: 'user-1' } };
    mocks.merchant = { isLoading: false, merchant: { id: merchantId } };
  });

  it('uses the authenticated user and active merchant query key for owner access', async () => {
    const queryClient = createQueryClient();
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          ...accessRow({ '*': { '*': true } }),
          is_owner: true,
          is_staff: false,
          role: 'owner',
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mocks.rpc).toHaveBeenCalledWith('get_user_access');
    expect(
      queryClient.getQueryData(['user-access', 'user-1', merchantId])
    ).toEqual({
      canCreate: true,
      canEdit: true,
      canManageIntegrations: true,
      canView: true,
    });
    expect(result.current).toMatchObject({
      canCreate: true,
      canEdit: true,
      canManageIntegrations: true,
      canView: true,
      error: null,
    });
  });

  it('fails closed while the RPC result is loading', () => {
    mocks.rpc.mockReturnValueOnce(new Promise(() => undefined));

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(createQueryClient()),
    });

    expect(result.current).toMatchObject({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
      isLoading: true,
    });
  });

  it('does not call the RPC while merchant context is still loading', () => {
    mocks.merchant = { isLoading: true, merchant: null };

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(createQueryClient()),
    });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
      isLoading: true,
    });
  });

  it('preserves cached access during background verification', async () => {
    const queryClient = createQueryClient();
    const refetch = createDeferred<{
      data: null;
      error: { message: string };
    }>();
    mocks.rpc
      .mockResolvedValueOnce({
        data: [accessRow({ '*': { '*': true } })],
        error: null,
      })
      .mockReturnValueOnce(refetch.promise);

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.canView).toBe(true));

    act(() => {
      void queryClient.invalidateQueries({
        queryKey: ['user-access', 'user-1', merchantId],
      });
    });

    await waitFor(() =>
      expect(result.current).toMatchObject({
        canCreate: true,
        canEdit: true,
        canManageIntegrations: true,
        canView: true,
        error: null,
        isLoading: false,
        isRefreshing: true,
      })
    );

    refetch.resolve({ data: null, error: { message: 'Permissions revoked' } });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

    expect(result.current).toMatchObject({
      canCreate: true,
      canEdit: true,
      canManageIntegrations: true,
      canView: true,
      isLoading: false,
      isRefreshing: false,
      error: expect.any(Error),
    });
  });

  it('fails closed when get_user_access has no row for the active merchant', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        { ...accessRow({ '*': { '*': true } }), merchant_id: otherMerchantId },
      ],
      error: null,
    });

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

    expect(result.current).toMatchObject({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
    });
  });

  it('fails closed for empty and rejected RPC responses', async () => {
    const scenarios = [
      { data: [], error: null },
      { data: null, error: { message: 'RPC unavailable' } },
    ];

    for (const response of scenarios) {
      mocks.rpc.mockResolvedValueOnce(response);
      const { result, unmount } = renderHook(() => useExpenseAccess(), {
        wrapper: createWrapper(createQueryClient()),
      });

      await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
      expect(result.current).toMatchObject({
        canCreate: false,
        canEdit: false,
        canManageIntegrations: false,
        canView: false,
      });
      unmount();
    }
  });

  it('denies access when expense grants use unsupported permission values', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [accessRow({ expenses: { view: 'allowed' } })],
      error: null,
    });

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toMatchObject({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
      error: null,
    });
  });

  it('requires both view and edit grants before exposing expense editing', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [accessRow({ expenses: { edit: true, view: false } })],
      error: null,
    });

    const { result } = renderHook(() => useExpenseAccess(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current).toMatchObject({
      canCreate: false,
      canEdit: false,
      canManageIntegrations: false,
      canView: false,
      error: null,
    });
  });
});
