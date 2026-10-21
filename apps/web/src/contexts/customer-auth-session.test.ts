import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commitCustomerAuthSession,
  loadCustomerSession,
  resetRememberedCustomerSessionsForTests,
} from '@/contexts/customer-auth-session';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { clearCartStorage } from '@/hooks/use-cart';

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  clearCartDeviceRevocationPending: vi.fn(),
  clearCartDeviceSessionActive: vi.fn(),
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

    expect(revokeCartDeviceSession).toHaveBeenCalledWith(
      'ogabassey',
      expect.objectContaining({ retiringUserId: 'user-1' })
    );
    expect(clearCartStorage).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setCustomer).toHaveBeenCalledWith(null);
    // The already-exchanged auth cookie must be rolled back too, not
    // just React state, or the new customer stays authenticated.
    expect(fetchMock).toHaveBeenCalledWith('/api/storefront/auth/logout', {
      method: 'POST',
    });

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
    expect(clearCartStorage).not.toHaveBeenCalled();
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
    expect(revokeCartDeviceSession).toHaveBeenCalledWith(
      'ogabassey',
      expect.objectContaining({ retiringUserId: 'user-1' })
    );
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(setUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-2' })
    );
    expect(setOtpState).toHaveBeenCalledWith(null);
  });

  it('refuses to restore an unconfirmed switched session when rollback logout fails until logout succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(revokeCartDeviceSession)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('logout failed', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setOtpState = vi.fn();
    const setIsLoading = vi.fn();

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

    expect(committed).toBe(false);
    expect(setUser).toHaveBeenCalledWith(null);

    setUser.mockClear();
    setCustomer.mockClear();

    await loadCustomerSession('ogabassey', {
      setCustomer,
      setIsLoading,
      setUser,
    });

    expect(fetchMock).toHaveBeenLastCalledWith('/api/storefront/auth/logout', {
      method: 'POST',
    });
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setCustomer).toHaveBeenCalledWith(null);
  });
});
