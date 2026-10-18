import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commitCustomerAuthSession,
  loadCustomerSession,
  prepareCustomerOAuthRedirect,
  resetRememberedCustomerSessionsForTests,
} from '@/contexts/customer-auth-session';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import {
  clearCartDeviceRevocationPending,
  markCartDeviceRevocationPending,
  resetPendingCartDeviceRevocationsForTests,
  revokeCartDeviceSession,
} from '@/hooks/cart/shared-cart-session-revoke-client';
import { clearCartStorage } from '@/hooks/use-cart';

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  clearCartDeviceRevocationPending: vi.fn(),
  markCartDeviceRevocationPending: vi.fn(),
  resetPendingCartDeviceRevocationsForTests: vi.fn(),
  revokeCartDeviceSession: vi.fn(),
}));
vi.mock('@/hooks/use-cart', () => ({
  clearCartStorage: vi.fn(),
}));

describe('customer-auth-session passive identity revocation', () => {
  afterEach(() => {
    resetRememberedCustomerSessionsForTests();
    publishCustomerIdentity(null, null, null);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('revokes device cart authority when an authenticated session expires on reload', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'one@example.com',
            first_name: 'One',
            id: 'customer-1',
            last_name: 'Buyer',
          },
          user: {
            email: 'one@example.com',
            id: 'user-1',
            role: 'customer',
          },
        })
      )
      .mockResolvedValueOnce(Response.json({ authenticated: false }));
    vi.stubGlobal('fetch', fetchMock);

    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });
    expect(revokeCartDeviceSession).not.toHaveBeenCalled();

    await loadCustomerSession('ogabassey', {
      currentUserId: 'user-1',
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(markCartDeviceRevocationPending).toHaveBeenCalledWith('ogabassey');
    expect(revokeCartDeviceSession).toHaveBeenCalledWith('ogabassey');
    expect(clearCartDeviceRevocationPending).toHaveBeenCalledWith('ogabassey');
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(setUser).toHaveBeenLastCalledWith(null);
    expect(setCustomer).toHaveBeenLastCalledWith(null);
    expect(resetPendingCartDeviceRevocationsForTests).not.toHaveBeenCalled();
  });

  it('keeps cart revocation fenced when passive session expiry revocation fails', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: false });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ authenticated: false }))
      .mockResolvedValueOnce(Response.json({ authenticated: false }));
    vi.stubGlobal('fetch', fetchMock);

    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    await loadCustomerSession('ogabassey', {
      currentUserId: 'user-1',
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(markCartDeviceRevocationPending).toHaveBeenCalledWith('ogabassey');
    expect(clearCartDeviceRevocationPending).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenLastCalledWith(null);

    vi.mocked(revokeCartDeviceSession).mockResolvedValueOnce({ ok: true });
    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(revokeCartDeviceSession).toHaveBeenCalledTimes(2);
    expect(clearCartDeviceRevocationPending).toHaveBeenCalledWith('ogabassey');
  });

  it('does not revoke cart authority or clear cart storage on session lookup failures', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'Internal server error' }, { status: 500 })
      )
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: null,
          user: {
            email: 'one@example.com',
            id: 'user-1',
            role: 'customer',
          },
        })
      )
      .mockRejectedValueOnce(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await loadCustomerSession('ogabassey', {
        currentUserId: 'user-1',
        setCustomer,
        setIsLoading,
        setUser,
      });
    }

    expect(markCartDeviceRevocationPending).not.toHaveBeenCalled();
    expect(revokeCartDeviceSession).not.toHaveBeenCalled();
    expect(clearCartStorage).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('revokes device cart authority when session load switches to a different user', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'one@example.com',
            first_name: 'One',
            id: 'customer-1',
            last_name: 'Buyer',
          },
          user: {
            email: 'one@example.com',
            id: 'user-1',
            role: 'customer',
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'two@example.com',
            first_name: 'Two',
            id: 'customer-2',
            last_name: 'Buyer',
          },
          user: {
            email: 'two@example.com',
            id: 'user-2',
            role: 'customer',
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();

    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });
    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(revokeCartDeviceSession).toHaveBeenCalledWith('ogabassey');
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(setUser).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'user-2' })
    );
  });

  it('blocks session-load and OTP identity switches when cart revocation fails', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: false });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'one@example.com',
            first_name: 'One',
            id: 'customer-1',
            last_name: 'Buyer',
          },
          user: {
            email: 'one@example.com',
            id: 'user-1',
            role: 'customer',
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'two@example.com',
            first_name: 'Two',
            id: 'customer-2',
            last_name: 'Buyer',
          },
          user: {
            email: 'two@example.com',
            id: 'user-2',
            role: 'customer',
          },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setIsLoading = vi.fn();
    const setOtpState = vi.fn();

    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });
    setUser.mockClear();
    setCustomer.mockClear();

    await loadCustomerSession('ogabassey', {
      currentUserId: 'user-1',
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(revokeCartDeviceSession).toHaveBeenCalledWith('ogabassey');
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setCustomer).toHaveBeenCalledWith(null);

    setUser.mockClear();
    setCustomer.mockClear();
    vi.mocked(clearCartStorage).mockClear();
    fetchMock.mockResolvedValueOnce(Response.json({ success: true }));

    const committed = await commitCustomerAuthSession(
      'ogabassey',
      {
        customer: {
          email: 'two@example.com',
          first_name: 'Two',
          id: 'customer-2',
          last_name: 'Buyer',
        },
        user: {
          email: 'two@example.com',
          id: 'user-2',
          role: 'customer',
        },
      },
      {
        setCustomer,
        setOtpState,
        setUser,
      }
    );

    expect(committed).toBe(false);
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/storefront/auth/logout', {
      method: 'POST',
    });
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setCustomer).toHaveBeenCalledWith(null);
    expect(setOtpState).not.toHaveBeenCalled();
  });

  it('revokes device cart authority when OTP verification replaces an authenticated user', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setOtpState = vi.fn();

    const committed = await commitCustomerAuthSession(
      'ogabassey',
      {
        customer: {
          email: 'two@example.com',
          first_name: 'Two',
          id: 'customer-2',
          last_name: 'Buyer',
        },
        user: {
          email: 'two@example.com',
          id: 'user-2',
          role: 'customer',
        },
      },
      {
        currentUserId: 'user-1',
        setCustomer,
        setOtpState,
        setUser,
      }
    );

    expect(committed).toBe(true);
    expect(revokeCartDeviceSession).toHaveBeenCalledWith('ogabassey');
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-2' })
    );
    expect(setOtpState).toHaveBeenCalledWith(null);
  });

  it('retires device cart authority before OAuth redirect when a customer is already signed in', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });

    const allowed = await prepareCustomerOAuthRedirect('ogabassey', 'user-1');

    expect(allowed).toBe(true);
    expect(revokeCartDeviceSession).toHaveBeenCalledWith('ogabassey');
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
  });
});
