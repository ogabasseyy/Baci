// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { scrubPrivateParamsFromAddressBar } from '@/lib/privacy/private-url-param-stash';
import { useCustomerLoginForm } from './use-customer-login-form';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account/login',
  useRouter: () => ({ push: vi.fn() }),
  // Reload: the router reports a clean query.
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: () => ({
    isAuthenticated: false,
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

describe('bugfix: login email prefill was lost on reload', () => {
  it('prefills the email from the stash when the reloaded address is already clean', () => {
    window.sessionStorage.clear();
    window.history.replaceState(
      null,
      '',
      '/account/login?email=buyer%40example.com'
    );
    scrubPrivateParamsFromAddressBar(); // first visit moves the email out of the URL
    expect(window.location.search).toBe('');

    const { result } = renderHook(() => useCustomerLoginForm());

    expect(result.current.email).toBe('buyer@example.com');
    window.history.replaceState(null, '', '/');
  });
});
