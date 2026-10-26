import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { AuthState } from './auth-store.types';
import { createInitializeAction } from './auth-store-initialize';
import { syncAuthenticatedState } from './auth-store-sync';

const mockSingle =
  jest.fn<() => Promise<{ data: { id: string }; error: null }>>();
const mockRetireDeviceCart = jest.fn<() => Promise<void>>();

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ single: mockSingle }) }),
    })),
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
      refreshSession: jest.fn(),
      signOut: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));
jest.mock('../lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));
jest.mock('../lib/push-token-storage', () => ({
  getStoredPushToken: jest.fn(),
}));
jest.mock('../lib/query-cache-observer-safety', () => ({
  clearQueryCachePreservingObservers: jest.fn(),
}));
jest.mock('../lib/query-client', () => ({ queryClient: {} }));
jest.mock('./auth-store-push', () => ({
  clearLocalAndDeactivatePushToken: jest.fn(),
}));
jest.mock('./auth-store-sync', () => ({ syncAuthenticatedState: jest.fn() }));
jest.mock('./clear-device-cart', () => ({
  clearDeviceCartForAccountTeardown: () => mockRetireDeviceCart(),
}));
jest.mock('./cart-store', () => ({
  useCartStore: { getState: () => ({ items: [] }) },
}));
jest.mock('./comparison-store', () => ({
  useComparisonStore: { getState: () => ({ clearComparison: jest.fn() }) },
}));
jest.mock('./quiz-store', () => ({
  useQuizStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('./saved-store', () => ({
  useSavedStore: { getState: () => ({ clearSaved: jest.fn() }) },
}));

const session: Session = {
  access_token: 'synthetic-access',
  refresh_token: 'synthetic-refresh',
  token_type: 'bearer',
  expires_in: 900,
  user: {
    id: '10000000-0000-4000-8000-000000000002',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-10-24T00:00:00Z',
  },
};

describe('auth startup network recovery', () => {
  let state: AuthState;
  let listener: (event: AuthChangeEvent, next: Session | null) => void;
  let initialize: () => Promise<void>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRetireDeviceCart.mockResolvedValue();
    state = {
      user: null,
      session: null,
      customer: null,
      merchantId: null,
      isLoading: true,
      isInitialized: false,
      error: null,
      _initGen: 0,
      _authSubscription: null,
      _initializationInProgress: false,
      initialize: async () => {},
      cleanup: () => {},
      signInWithOtp: async () => ({ success: true }),
      verifyOtp: async () => ({ success: true }),
      signInWithPassword: async () => ({ success: true }),
      signInWithGoogle: async () => ({ success: true }),
      signInWithApple: async () => ({ success: true }),
      signOut: async () => {},
      deleteAccount: async () => ({ success: false, error: 'Not tested' }),
      refreshSession: async () => {},
      updateProfile: async () => ({ success: true }),
      setUsername: async () => ({ success: true }),
      setDateOfBirth: async () => ({ success: true }),
      clearError: () => {},
    };
    mockSingle.mockResolvedValue({
      data: { id: '10000000-0000-4000-8000-000000000001' },
      error: null,
    });
    jest
      .mocked(supabase.auth.getSession)
      .mockResolvedValue({ data: { session }, error: null });
    jest.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: null },
      error: { message: 'JWT expired', status: 401 },
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
    jest.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    jest
      .mocked(supabase.auth.onAuthStateChange)
      .mockImplementation((callback) => {
        listener = callback;
        return {
          data: {
            subscription: {
              id: 'synthetic-listener',
              callback,
              unsubscribe: jest.fn(),
            },
          },
        };
      });
    jest
      .mocked(syncAuthenticatedState)
      .mockImplementation(async ({ set, user, session: next }) => {
        set({ user, session: next, error: null });
      });
    initialize = createInitializeAction({
      get: () => state,
      set: (update) => {
        state = { ...state, ...update };
      },
      merchantSlug: 'savings-synthetic',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not sign out when an expired access token refresh returns 503', async () => {
    jest.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Service unavailable', status: 503 },
    } as Awaited<ReturnType<typeof supabase.auth.refreshSession>>);
    await initialize();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(state.session).toEqual(session);
    expect(state.user).toEqual(session.user);
  });

  it('retains a recovery listener after getSession returns a retryable fetch error', async () => {
    jest.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: {
        name: 'AuthRetryableFetchError',
        message: 'Network request failed',
        status: 503,
      },
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
    await initialize();
    expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    listener('TOKEN_REFRESHED', session);
    await jest.runOnlyPendingTimersAsync();
    expect(state.user).toEqual(session.user);
    expect(state.session).toEqual(session);
    expect(state.error).toBeNull();
  });

  it('clears local auth only when refresh definitively rejects its token', async () => {
    jest.mocked(supabase.auth.refreshSession).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Refresh token expired', status: 400 },
    } as Awaited<ReturnType<typeof supabase.auth.refreshSession>>);
    await initialize();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(state.session).toBeNull();
  });

  it('fences the prior identity while switched-account cart retirement is pending', async () => {
    jest.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: session.user },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getUser>>);
    let finishRetirement!: () => void;
    mockRetireDeviceCart.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRetirement = resolve;
      })
    );
    await initialize();
    expect(state.user).toEqual(session.user);
    expect(state.session).toEqual(session);

    listener('INITIAL_SESSION', session);
    await jest.runOnlyPendingTimersAsync();
    expect(state.user).toEqual(session.user);

    const switchedSession: Session = {
      ...session,
      user: { ...session.user, id: '10000000-0000-4000-8000-000000000003' },
    };
    listener('SIGNED_IN', switchedSession);
    await jest.runOnlyPendingTimersAsync();

    expect(mockRetireDeviceCart).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({
      customer: null,
      isLoading: true,
      session: null,
      user: null,
    });

    finishRetirement();
    await jest.runOnlyPendingTimersAsync();
  });
});
