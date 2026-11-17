// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerLoginForm } from './use-customer-login-form';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  state: { searchParams: new URLSearchParams(), isReady: true },
}));

vi.mock('@/hooks/use-private-search-params', () => ({
  usePrivateSearchParamsState: () => mocks.state,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    otpState: null,
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
    signInWithGoogle: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: null, loading: false }),
}));
vi.mock('@/lib/customer-login-prefill', () => ({
  sanitizeCustomerLoginEmailPrefill: (email: string | null) => email || '',
  fetchCustomerLoginEmailHintForRedirect: async () => null,
}));
vi.mock('@/lib/routes', () => ({ asRoute: (path: string) => path }));

describe('bugfix: reloaded login link redirected and prefilled before the stash was readable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not redirect an already signed-in customer while the stashed redirect target is unreadable', () => {
    mocks.state = { searchParams: new URLSearchParams(), isReady: false };

    renderHook(() => useCustomerLoginForm());

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('redirects to the stashed target and prefills the email once ready', () => {
    mocks.state = { searchParams: new URLSearchParams(), isReady: false };
    const { result, rerender } = renderHook(() => useCustomerLoginForm());
    expect(result.current.email).toBe('');

    mocks.state = {
      searchParams: new URLSearchParams({
        redirect: '/receipts/claim/token-1',
        email: 'buyer@example.com',
      }),
      isReady: true,
    };
    rerender();

    expect(result.current.email).toBe('buyer@example.com');
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/receipts/claim/token-1');
  });
});
