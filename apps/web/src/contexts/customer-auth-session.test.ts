import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCustomerSession,
  performCustomerLogout,
} from '@/contexts/customer-auth-session';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import { clearCartStorage } from '@/hooks/use-cart';

vi.mock('@/hooks/use-cart', () => ({
  clearCartStorage: vi.fn(),
}));

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  revokeCartDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/contexts/customer-live-identity', () => ({
  publishCustomerIdentity: vi.fn(),
}));

const USER = { email: 'quiz@example.com', id: 'user-1', role: 'customer' };
const CUSTOMER = {
  email: 'quiz@example.com',
  first_name: 'Quiz',
  id: 'customer-1',
  last_name: 'Tester',
};

function stubSessionFetch(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
}

describe('customer-auth-session', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('publishes the loaded session to setters and live identity', async () => {
    stubSessionFetch({ authenticated: true, customer: CUSTOMER, user: USER });
    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(setUser).toHaveBeenCalledWith(USER);
    expect(setCustomer).toHaveBeenCalledWith(CUSTOMER);
    expect(publishCustomerIdentity).toHaveBeenCalledWith(
      USER,
      CUSTOMER,
      'ogabassey'
    );
    expect(setIsLoading).toHaveBeenCalledWith(false);
  });

  it('clears state and identity when the session fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(setUser).toHaveBeenCalledWith(null);
    expect(setCustomer).toHaveBeenCalledWith(null);
    expect(publishCustomerIdentity).toHaveBeenCalledWith(
      null,
      null,
      'ogabassey'
    );
    expect(setIsLoading).toHaveBeenCalledWith(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('leaves state untouched when the load is cancelled', async () => {
    stubSessionFetch({ authenticated: true, customer: CUSTOMER, user: USER });
    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    await loadCustomerSession(
      'ogabassey',
      { setCustomer, setIsLoading, setUser },
      () => true
    );

    expect(setUser).not.toHaveBeenCalled();
    expect(setCustomer).not.toHaveBeenCalled();
    expect(setIsLoading).not.toHaveBeenCalled();
    expect(publishCustomerIdentity).not.toHaveBeenCalled();
  });

  it('clears identity, otp, and cart even when the logout call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setOtpState = vi.fn();

    await performCustomerLogout('ogabassey', setUser, setCustomer, setOtpState);

    expect(setUser).toHaveBeenCalledWith(null);
    expect(setCustomer).toHaveBeenCalledWith(null);
    expect(setOtpState).toHaveBeenCalledWith(null);
    expect(publishCustomerIdentity).toHaveBeenCalledWith(
      null,
      null,
      'ogabassey'
    );
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey');
  });
});
