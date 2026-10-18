import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  commitCustomerAuthSession,
  loadCustomerSession,
  prepareCustomerOAuthRedirect,
  resetRememberedCustomerSessionsForTests,
} from '@/contexts/customer-auth-session';
import { publishCustomerIdentity } from '@/contexts/customer-live-identity';
import { revokeCartDeviceSession } from '@/hooks/cart/shared-cart-session-revoke-client';
import { clearCartStorage } from '@/hooks/use-cart';

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
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

    expect(revokeCartDeviceSession).toHaveBeenCalledWith('ogabassey');
    expect(clearCartStorage).toHaveBeenCalledWith('ogabassey', 'user-1');
    expect(setUser).toHaveBeenLastCalledWith(null);
    expect(setCustomer).toHaveBeenLastCalledWith(null);
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

  it('revokes device cart authority when OTP verification replaces an authenticated user', async () => {
    vi.mocked(revokeCartDeviceSession).mockResolvedValue({ ok: true });
    const setUser = vi.fn();
    const setCustomer = vi.fn();
    const setOtpState = vi.fn();

    await commitCustomerAuthSession(
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
