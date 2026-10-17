import { render, screen, waitFor } from '@testing-library/react';
import { act, Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CustomerAuthProvider,
  useCustomerAuth,
  useOptionalCustomerAuth,
} from '@/contexts/customer-auth-context';
import {
  getLiveCustomerIdentity,
  publishCustomerIdentity,
} from '@/contexts/customer-live-identity';

vi.mock('@/hooks/use-cart', () => ({
  clearCartStorage: vi.fn(),
}));

function AuthProbe() {
  const { customer, isAuthenticated, isLoading } = useCustomerAuth();

  return (
    <p>
      {isLoading
        ? 'loading'
        : isAuthenticated
          ? `authenticated:${customer?.email}`
          : 'guest'}
    </p>
  );
}

function OptionalAuthProbe() {
  const auth = useOptionalCustomerAuth();

  return <p>{auth ? 'has-provider' : 'missing-provider'}</p>;
}

describe('CustomerAuthProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('checks the storefront customer session once on initial auth hydration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        authenticated: true,
        customer: {
          email: 'quiz@example.com',
          first_name: 'Quiz',
          id: 'customer-1',
          last_name: 'Tester',
        },
        user: {
          email: 'quiz@example.com',
          id: 'user-1',
          role: 'customer',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(
      await screen.findByText('authenticated:quiz@example.com')
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storefront/auth/session?merchantSlug=ogabassey'
    );
  });

  it('renders a guest session when the customer is not authenticated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        authenticated: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('guest')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('allows optional consumers to render outside the customer auth provider', () => {
    render(<OptionalAuthProbe />);

    expect(screen.getByText('missing-provider')).toBeInTheDocument();
  });

  it('allows optional consumers to read the customer auth provider when present', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        authenticated: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <OptionalAuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('has-provider')).toBeInTheDocument();
  });

  it('clears stale customer state while hydrating a new merchant slug', async () => {
    let resolveSecondSession: (response: Response) => void = () => undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'first@example.com',
            first_name: 'First',
            id: 'customer-1',
            last_name: 'Customer',
          },
          user: {
            email: 'first@example.com',
            id: 'user-1',
            role: 'customer',
          },
        })
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveSecondSession = resolve;
          })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <CustomerAuthProvider merchantSlug="first-store">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(
      await screen.findByText('authenticated:first@example.com')
    ).toBeInTheDocument();

    rerender(
      <CustomerAuthProvider merchantSlug="second-store">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('loading')).toBeInTheDocument();
    expect(
      screen.queryByText('authenticated:first@example.com')
    ).not.toBeInTheDocument();

    resolveSecondSession(
      Response.json({
        authenticated: true,
        customer: {
          email: 'second@example.com',
          first_name: 'Second',
          id: 'customer-2',
          last_name: 'Customer',
        },
        user: {
          email: 'second@example.com',
          id: 'user-2',
          role: 'customer',
        },
      })
    );

    expect(
      await screen.findByText('authenticated:second@example.com')
    ).toBeInTheDocument();
  });

  it('renders a guest session when hydration fails', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error('session endpoint failed'));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    expect(await screen.findByText('guest')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      'Session check error:',
      expect.any(Error)
    );
  });

  it('does not update state after the provider unmounts during hydration', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let resolveSession: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveSession = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(
      <CustomerAuthProvider merchantSlug="ogabassey">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    unmount();
    resolveSession(
      Response.json({
        authenticated: true,
        customer: {
          email: 'quiz@example.com',
          first_name: 'Quiz',
          id: 'customer-1',
          last_name: 'Tester',
        },
        user: {
          email: 'quiz@example.com',
          id: 'user-1',
          role: 'customer',
        },
      })
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('publishes the identity reset when the storefront slug commits a change', async () => {
    // Codex R129 P2 (behavioral half): a committed slug change must
    // reset the live identity so in-flight results from the old
    // store are discarded. The second session load hangs, pinning
    // the post-reset state deterministically (otherwise the load
    // would immediately overwrite it).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'a@example.com',
            first_name: 'A',
            id: 'customer-a',
            last_name: 'User',
          },
          user: { email: 'a@example.com', id: 'user-a', role: 'customer' },
        })
      )
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <CustomerAuthProvider merchantSlug="store-a">
        <AuthProbe />
      </CustomerAuthProvider>
    );
    await waitFor(() =>
      expect(getLiveCustomerIdentity()).toEqual({
        customerId: 'customer-a',
        merchantSlug: 'store-a',
        userId: 'user-a',
      })
    );

    rerender(
      <CustomerAuthProvider merchantSlug="store-b">
        <AuthProbe />
      </CustomerAuthProvider>
    );

    // The reset publishes synchronously before the hanging load's
    // fetch starts, so by the second fetch the reset has landed.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(getLiveCustomerIdentity()).toEqual({
      customerId: null,
      merchantSlug: 'store-b',
      userId: null,
    });
  });

  it('does not publish a merchant switch for a render that never commits', async () => {
    // Codex R129 P2 (mechanistic half): a concurrent render that
    // suspends before committing must leave the live identity
    // untouched — module mutations cannot roll back like setState,
    // so a speculative publish would discard a healthy in-flight
    // checkout from the still-committed storefront.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ authenticated: false }));
    vi.stubGlobal('fetch', fetchMock);

    let suspenderThrows = 0;
    let suspendOnSlug: string | null = null;
    function Suspender({ slug }: { slug: string }) {
      if (suspendOnSlug !== null && slug === suspendOnSlug) {
        suspenderThrows += 1;
        throw new Promise(() => {});
      }
      return null;
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <Suspense fallback={null}>
            <CustomerAuthProvider merchantSlug="store-a">
              <Suspender slug="store-a" />
            </CustomerAuthProvider>
          </Suspense>
        );
      });
      expect(getLiveCustomerIdentity().merchantSlug).toBe('store-a');

      suspendOnSlug = 'store-b';
      await act(async () => {
        root.render(
          <Suspense fallback={null}>
            <CustomerAuthProvider merchantSlug="store-b">
              <Suspender slug="store-b" />
            </CustomerAuthProvider>
          </Suspense>
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // The store-b render ran (and suspended) but never committed.
      expect(suspenderThrows).toBeGreaterThan(0);
      expect(getLiveCustomerIdentity()).toEqual({
        customerId: null,
        merchantSlug: 'store-a',
        userId: null,
      });
    } finally {
      suspendOnSlug = null;
      publishCustomerIdentity(null, null, null);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('publishes the merchant reset before any post-commit layout reader runs', async () => {
    // Codex R133 P2: a promise continuation settling in the
    // post-commit / pre-passive-flush window must already see the
    // reset — otherwise it accepts the old storefront's identity
    // and publishes the old store's result into the new view. The
    // sibling spy reads the singleton from its own layout effect,
    // which runs after the provider's layout effects but before
    // ANY passive effect of the same commit — exactly the window
    // under test. Fails pre-fix: the passive publish has not run
    // yet, so the spy still sees store-a.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          authenticated: true,
          customer: {
            email: 'a@example.com',
            first_name: 'A',
            id: 'customer-a',
            last_name: 'User',
          },
          user: { email: 'a@example.com', id: 'user-a', role: 'customer' },
        })
      )
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);

    const seenAtLayout: ReturnType<typeof getLiveCustomerIdentity>[] = [];
    function LayoutSpy() {
      useLayoutEffect(() => {
        seenAtLayout.push({ ...getLiveCustomerIdentity() });
      });
      return null;
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <>
            <CustomerAuthProvider merchantSlug="store-a">
              <AuthProbe />
            </CustomerAuthProvider>
            <LayoutSpy />
          </>
        );
      });
      await waitFor(() =>
        expect(getLiveCustomerIdentity()).toEqual({
          customerId: 'customer-a',
          merchantSlug: 'store-a',
          userId: 'user-a',
        })
      );

      seenAtLayout.length = 0;
      await act(async () => {
        root.render(
          <>
            <CustomerAuthProvider merchantSlug="store-b">
              <AuthProbe />
            </CustomerAuthProvider>
            <LayoutSpy />
          </>
        );
      });

      // The update commit's layout phase already saw the reset —
      // no post-commit window exposes the stale storefront.
      expect(seenAtLayout.length).toBeGreaterThan(0);
      expect(seenAtLayout.at(-1)).toEqual({
        customerId: null,
        merchantSlug: 'store-b',
        userId: null,
      });
    } finally {
      publishCustomerIdentity(null, null, null);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
