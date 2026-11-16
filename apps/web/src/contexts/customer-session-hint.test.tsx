import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerAuthProvider,
  useCustomerAuth,
} from '@/contexts/customer-auth-context';
import { signInWithGoogle } from '@/contexts/customer-auth-oauth';
import {
  commitCustomerAuthSession,
  performCustomerLogout,
  resetRememberedCustomerSessionsForTests,
} from '@/contexts/customer-auth-session';
import {
  getCustomerSessionHintScopePath,
  readCustomerSessionHint,
  writeCustomerSessionHint,
} from '@/contexts/customer-session-hint';

vi.mock('@/hooks/use-cart', () => ({
  clearCartStorage: vi.fn(),
}));

vi.mock('@/hooks/cart/shared-cart-session-revoke-client', () => ({
  beginDeferredCartLogout: vi.fn(),
  cancelDeferredCartLogout: vi.fn(),
  clearCartDeviceRevocationPending: vi.fn(),
  clearCartDeviceSessionActive: vi.fn(),
  endDeferredCartLogout: vi.fn(),
  markCartDeviceRevocationPending: vi.fn(),
  resetPendingCartDeviceRevocationsForTests: vi.fn(),
  revokeCartDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
}));

function AuthProbe() {
  const { customer, isAuthenticated, isLoading } = useCustomerAuth();
  if (isLoading) return <p>loading</p>;
  return <p>{isAuthenticated ? `auth:${customer?.email}` : 'guest'}</p>;
}

describe('baci_customer_session_hint tri-state behavior', () => {
  afterEach(() => {
    resetRememberedCustomerSessionsForTests();
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls session endpoint when hint is missing and stamps "0" for anonymous visitors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ authenticated: false }));
    vi.stubGlobal('fetch', fetchMock);

    expect(readCustomerSessionHint()).toBeNull();

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCustomerSessionHint()).toBe('0');
  });

  it('calls session endpoint when hint is missing and stamps "1" for authenticated visitors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        authenticated: true,
        customer: {
          id: 'cust-1',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
        },
        user: { id: 'user-1', email: 'ada@example.com', role: 'customer' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('auth:ada@example.com')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCustomerSessionHint()).toBe('1');
  });

  it('skips session endpoint when hint is "0"', async () => {
    writeCustomerSessionHint('ogabassey', '0');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('guest')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it('flips hint from "1" to "0" on 401 session response, but preserves "1" on 500', async () => {
    writeCustomerSessionHint('ogabassey', '1');
    const fetch500 = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetch500);

    const { unmount } = render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );
    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(fetch500).toHaveBeenCalledTimes(1);
    expect(readCustomerSessionHint()).toBe('1');
    unmount();

    const fetch401 = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetch401);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );
    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(fetch401).toHaveBeenCalledTimes(1);
    expect(readCustomerSessionHint()).toBe('0');
  });

  it('updates hint on commitCustomerAuthSession, performCustomerLogout, and clears before OAuth redirect', async () => {
    await commitCustomerAuthSession(
      'ogabassey',
      {
        customer: {
          id: 'cust-1',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
        },
        user: { id: 'user-1', email: 'ada@example.com', role: 'customer' },
      },
      {
        setUser: vi.fn(),
        setCustomer: vi.fn(),
        setOtpState: vi.fn(),
      }
    );
    expect(readCustomerSessionHint()).toBe('1');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ok: true }))
    );
    await performCustomerLogout(
      'ogabassey',
      vi.fn(),
      vi.fn(),
      vi.fn(),
      'user-1'
    );
    expect(readCustomerSessionHint()).toBe('0');

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ url: 'https://accounts.google.com/o/oauth2/auth' })
        )
    );
    await signInWithGoogle('ogabassey', '/account');
    expect(readCustomerSessionHint()).toBeNull();
  });

  it('preserves unknown hint when session endpoint fails with 503', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: 'Session lookup failed' }, { status: 503 })
      );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCustomerSessionHint()).toBeNull();
  });

  it('scopes cookie path to /{merchantSlug} in path-routing mode', () => {
    window.history.replaceState({}, '', '/ogabassey/products');
    expect(getCustomerSessionHintScopePath('ogabassey')).toBe('/ogabassey');

    window.history.replaceState({}, '', '/products');
    expect(getCustomerSessionHintScopePath('ogabassey')).toBe('/');
  });
});
