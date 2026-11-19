// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  getSession: vi.fn(),
  merchant: { id: 'merchant-1' } as { id: string } | null,
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: mocks.merchant }),
}));
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => mocks.apiClient(...args),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mocks.getSession(...args) },
    from: vi.fn(),
  },
}));

import { useInviteStaff } from './useStaff';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
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

describe('useInviteStaff virtual terminal creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant = { id: 'merchant-1' };
    mocks.apiClient.mockResolvedValue({ staff: { id: 'staff-1' } });
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token-1' } },
    });
  });

  it('passes the active merchant when auto-creating a staff terminal', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useInviteStaff(), {
      wrapper: createWrapper().Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        autoCreateAccount: true,
        email: 'ada@example.com',
        name: 'Ada',
        role: 'sales_rep',
      });
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://usebaci.com/api/paystack/virtual-terminal',
      expect.objectContaining({
        body: JSON.stringify({
          merchantId: 'merchant-1',
          name: "Ada's Account",
          staffId: 'staff-1',
        }),
      })
    );
  });

  it('does not invalidate merchant B staff data when an invitation for A settles after a switch', async () => {
    let resolveInvite!: (response: { staff: { id: string } }) => void;
    mocks.apiClient.mockReturnValueOnce(
      new Promise<{ staff: { id: string } }>((resolve) => {
        resolveInvite = resolve;
      })
    );
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result, rerender } = renderHook(() => useInviteStaff(), {
      wrapper: Wrapper,
    });

    let invite!: Promise<unknown>;
    await act(async () => {
      invite = result.current.mutateAsync({
        email: 'ada@example.com',
        role: 'sales_rep',
      });
      await vi.waitFor(() => expect(mocks.apiClient).toHaveBeenCalledOnce());
    });

    mocks.merchant = { id: 'merchant-2' };
    rerender();
    await act(async () => {
      resolveInvite({ staff: { id: 'staff-1' } });
      await invite;
    });

    expect(mocks.apiClient).toHaveBeenCalledWith('/api/staff', {
      method: 'POST',
      headers: { 'x-baci-merchant-id': 'merchant-1' },
      body: JSON.stringify({
        email: 'ada@example.com',
        name: undefined,
        role: 'sales_rep',
      }),
    });
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
