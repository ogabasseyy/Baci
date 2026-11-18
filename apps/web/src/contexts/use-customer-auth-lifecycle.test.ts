import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadCustomerSession = vi.fn();
const mockPublishCustomerIdentity = vi.fn();

vi.mock('./customer-auth-session', () => ({
  loadCustomerSession: (...args: unknown[]) => mockLoadCustomerSession(...args),
}));

vi.mock('./customer-live-identity', () => ({
  publishCustomerIdentity: (...args: unknown[]) =>
    mockPublishCustomerIdentity(...args),
}));

import { useCustomerAuthLifecycle } from './use-customer-auth-lifecycle';

describe('useCustomerAuthLifecycle', () => {
  const setUser = vi.fn();
  const setCustomer = vi.fn();
  const setIsLoading = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadCustomerSession.mockResolvedValue(undefined);
  });

  it('publishes null identity and bootstraps session on mount', () => {
    renderHook(() =>
      useCustomerAuthLifecycle({
        merchantSlug: 'ogabassey',
        user: null,
        setUser,
        setCustomer,
        setIsLoading,
      })
    );

    expect(mockPublishCustomerIdentity).toHaveBeenCalledWith(
      null,
      null,
      'ogabassey'
    );
    expect(mockLoadCustomerSession).toHaveBeenCalledWith(
      'ogabassey',
      { setUser, setCustomer, setIsLoading },
      expect.any(Function)
    );
  });

  it('bypasses session hint on checkSession and skips refresh when signed out', async () => {
    const { result, rerender } = renderHook(
      ({
        user,
      }: {
        user: { id: string; email: string; role: string } | null;
      }) =>
        useCustomerAuthLifecycle({
          merchantSlug: 'ogabassey',
          user,
          setUser,
          setCustomer,
          setIsLoading,
        }),
      {
        initialProps: {
          user: null as { id: string; email: string; role: string } | null,
        },
      }
    );

    vi.clearAllMocks();

    await act(async () => {
      await result.current.refreshCustomer();
    });
    expect(mockLoadCustomerSession).not.toHaveBeenCalled();

    rerender({
      user: { id: 'user-1', email: 'ada@example.com', role: 'customer' },
    });
    await act(async () => {
      await result.current.refreshCustomer();
    });

    expect(mockLoadCustomerSession).toHaveBeenCalledWith(
      'ogabassey',
      {
        currentUserId: 'user-1',
        setUser,
        setCustomer,
        setIsLoading,
      },
      undefined,
      { bypassSessionHint: true }
    );
  });
});
