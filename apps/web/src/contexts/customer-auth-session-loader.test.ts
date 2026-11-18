import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReconcileOrphanedDeferredCartLogout,
  mockRetirePreviousAccountCartAuthority,
  mockGetRememberedCustomerUserId,
  mockIsCustomerAuthRollbackPending,
  mockRollbackCustomerAuthSession,
  mockSetRememberedCustomerUserId,
  mockInvalidateCustomerIdentityObservers,
  mockPublishCustomerIdentity,
  mockReadCustomerSessionHint,
  mockWriteCustomerSessionHint,
} = vi.hoisted(() => ({
  mockReconcileOrphanedDeferredCartLogout: vi.fn(),
  mockRetirePreviousAccountCartAuthority: vi.fn(),
  mockGetRememberedCustomerUserId: vi.fn(),
  mockIsCustomerAuthRollbackPending: vi.fn(),
  mockRollbackCustomerAuthSession: vi.fn(),
  mockSetRememberedCustomerUserId: vi.fn(),
  mockInvalidateCustomerIdentityObservers: vi.fn(),
  mockPublishCustomerIdentity: vi.fn(),
  mockReadCustomerSessionHint: vi.fn(),
  mockWriteCustomerSessionHint: vi.fn(),
}));

vi.mock('@/hooks/cart/cart-deferred-logout', () => ({
  reconcileOrphanedDeferredCartLogout: (...args: unknown[]) =>
    mockReconcileOrphanedDeferredCartLogout(...args),
}));
vi.mock('./customer-auth-retirement', () => ({
  retirePreviousAccountCartAuthority: (...args: unknown[]) =>
    mockRetirePreviousAccountCartAuthority(...args),
}));
vi.mock('./customer-auth-storage', () => ({
  getRememberedCustomerUserId: (...args: unknown[]) =>
    mockGetRememberedCustomerUserId(...args),
  isCustomerAuthRollbackPending: (...args: unknown[]) =>
    mockIsCustomerAuthRollbackPending(...args),
  rollbackCustomerAuthSession: (...args: unknown[]) =>
    mockRollbackCustomerAuthSession(...args),
  setRememberedCustomerUserId: (...args: unknown[]) =>
    mockSetRememberedCustomerUserId(...args),
}));
vi.mock('./customer-live-identity', () => ({
  invalidateCustomerIdentityObservers: (...args: unknown[]) =>
    mockInvalidateCustomerIdentityObservers(...args),
  publishCustomerIdentity: (...args: unknown[]) =>
    mockPublishCustomerIdentity(...args),
}));
vi.mock('./customer-session-hint', () => ({
  readCustomerSessionHint: () => mockReadCustomerSessionHint(),
  writeCustomerSessionHint: (...args: unknown[]) =>
    mockWriteCustomerSessionHint(...args),
}));

import {
  invalidateCustomerSessionLifecycle,
  loadCustomerSession,
} from './customer-auth-session-loader';

describe('loadCustomerSession', () => {
  const setUser = vi.fn();
  const setCustomer = vi.fn();
  const setIsLoading = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCustomerAuthRollbackPending.mockReturnValue(false);
    mockGetRememberedCustomerUserId.mockReturnValue(null);
    mockReadCustomerSessionHint.mockReturnValue(null);
    mockRetirePreviousAccountCartAuthority.mockResolvedValue(true);
    mockRollbackCustomerAuthSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips network lookup when hint is "0" unless bypassSessionHint is true', async () => {
    mockReadCustomerSessionHint.mockReturnValue('0');
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        authenticated: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await loadCustomerSession('ogabassey', {
      setUser,
      setCustomer,
      setIsLoading,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setIsLoading).toHaveBeenCalledWith(false);

    await loadCustomerSession(
      'ogabassey',
      { setUser, setCustomer, setIsLoading },
      () => false,
      { bypassSessionHint: true }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rolls back immediately when a rollback is already pending', async () => {
    mockIsCustomerAuthRollbackPending.mockReturnValue(true);
    mockGetRememberedCustomerUserId.mockReturnValue('user-1');

    await loadCustomerSession('ogabassey', {
      setUser,
      setCustomer,
      setIsLoading,
    });

    expect(mockRetirePreviousAccountCartAuthority).toHaveBeenCalledWith(
      'ogabassey',
      'user-1'
    );
    expect(mockRollbackCustomerAuthSession).toHaveBeenCalledWith('ogabassey');
    expect(mockWriteCustomerSessionHint).toHaveBeenCalledWith('ogabassey', '0');
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setIsLoading).toHaveBeenCalledWith(false);
  });

  it('rolls back and writes "0" hint if retiring previous account cart fails on user switch', async () => {
    mockGetRememberedCustomerUserId.mockReturnValue('old-user');
    mockRetirePreviousAccountCartAuthority.mockResolvedValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          authenticated: true,
          user: { id: 'new-user', email: 'new@example.com' },
          customer: { id: 'cust-2', email: 'new@example.com' },
        })
      )
    );

    await loadCustomerSession('ogabassey', {
      setUser,
      setCustomer,
      setIsLoading,
    });

    expect(mockRollbackCustomerAuthSession).toHaveBeenCalledWith('ogabassey');
    expect(mockWriteCustomerSessionHint).toHaveBeenCalledWith('ogabassey', '0');
    expect(setUser).toHaveBeenCalledWith(null);
  });

  it('does not publish state or write hint when cancelled mid-flight', async () => {
    let cancelled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        cancelled = true;
        return Response.json({
          authenticated: true,
          user: { id: 'user-1', email: 'a@example.com' },
          customer: { id: 'cust-1', email: 'a@example.com' },
        });
      })
    );

    await loadCustomerSession(
      'ogabassey',
      { setUser, setCustomer, setIsLoading },
      () => cancelled
    );

    expect(setUser).not.toHaveBeenCalled();
    expect(mockWriteCustomerSessionHint).not.toHaveBeenCalled();
    expect(setIsLoading).not.toHaveBeenCalled();
  });

  it('preserves unknown hint on 503 lookup failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'Session lookup failed' }, { status: 503 })
        )
    );

    await loadCustomerSession('ogabassey', {
      setUser,
      setCustomer,
      setIsLoading,
    });

    expect(mockWriteCustomerSessionHint).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith(null);
    expect(setIsLoading).toHaveBeenCalledWith(false);
  });

  it('ignores stale authenticated responses that resolve after logout invalidates the lifecycle', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );

    const loadPromise = loadCustomerSession('ogabassey', {
      setUser,
      setCustomer,
      setIsLoading,
    });

    invalidateCustomerSessionLifecycle('ogabassey');
    resolveFetch?.(
      Response.json({
        authenticated: true,
        user: { id: 'user-1', email: 'a@example.com', role: 'customer' },
        customer: {
          id: 'cust-1',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'a@example.com',
        },
      })
    );
    await loadPromise;

    expect(setUser).not.toHaveBeenCalled();
    expect(mockWriteCustomerSessionHint).not.toHaveBeenCalled();
    expect(setIsLoading).not.toHaveBeenCalled();
  });
});
