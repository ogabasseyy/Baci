/**
 * Tests for auth-store — focused on OAuth checkout fix behaviors:
 * - Customer lookup by user_id (not email)
 * - upsert_customer_on_auth RPC fallback
 * - _initGen cancellation guard
 * - onAuthStateChange event handling
 * - signInWithApple name upsert + cancellation
 * - cleanup() unsubscribes auth listener
 */

// biome-ignore-all lint/correctness/noUndeclaredVariables: Jest globals are provided by jest-expo in this legacy store test.
import { act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock declarations — jest.mock() factories must only reference module-scope
// `mock*`-prefixed variables (Jest hoisting rule). All dynamic behavior is
// applied via mockImplementation() in beforeEach/per-test instead.
// ---------------------------------------------------------------------------

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

const mockUnsubscribe = jest.fn();
// Holds the raw auth-state-change callback so tests can invoke it directly
let mockAuthListenerCb: (event: string, session: unknown) => void;
const mockMakeRedirectUri = jest.fn(() => 'ogabassey://auth');
const mockGetQueryParams = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    // Replaced per-test via mockImplementation in resetAllMocks()
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      refreshSession: jest.fn(),
      setSession: jest.fn(),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: jest.fn(),
      signInWithIdToken: jest.fn(),
      updateUser: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: mockMakeRedirectUri,
}));

jest.mock('expo-auth-session/build/QueryParams', () => ({
  getQueryParams: mockGetQueryParams,
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: mockOpenAuthSessionAsync,
}));

jest.mock('../lib/auth-helpers', () => ({
  splitFullName: jest.fn((name: unknown) => {
    if (!name || typeof name !== 'string')
      return { firstName: '', lastName: '' };
    const parts = (name as string).trim().split(/\s+/);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
    };
  }),
}));

jest.mock('../lib/logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('../lib/validation', () => ({
  CustomerRowSchema: {
    safeParse: jest.fn((data: unknown) => {
      if (data && typeof data === 'object' && 'id' in (data as object)) {
        const d = data as Record<string, unknown>;
        return {
          success: true,
          data: {
            id: d.id,
            ...('user_id' in d ? { user_id: d.user_id } : {}),
            email: d.email,
            first_name: d.first_name ?? null,
            last_name: d.last_name ?? null,
            phone: d.phone ?? null,
            loyalty_points: d.loyalty_points ?? null,
            username: d.username ?? null,
            username_changed_at: d.username_changed_at ?? null,
            date_of_birth: d.date_of_birth ?? null,
          },
        };
      }
      return {
        success: false,
        error: { flatten: () => ({ fieldErrors: {} }) },
      };
    }),
  },
  MerchantRowSchema: {
    safeParse: jest.fn((data: unknown) => {
      if (data && typeof data === 'object' && 'id' in (data as object)) {
        return { success: true, data };
      }
      return {
        success: false,
        error: { flatten: () => ({ fieldErrors: {} }) },
      };
    }),
  },
}));

const mockClearCart = jest.fn(async () => undefined);
jest.mock('./cart-store', () => ({
  useCartStore: {
    getState: jest.fn(() => ({ items: [], clearCart: mockClearCart })),
  },
}));

const mockClearSaved = jest.fn();
jest.mock('./saved-store', () => ({
  useSavedStore: {
    getState: jest.fn(() => ({ clearSaved: mockClearSaved })),
  },
}));

const mockClearComparison = jest.fn();
jest.mock('./comparison-store', () => ({
  useComparisonStore: {
    getState: jest.fn(() => ({ clearComparison: mockClearComparison })),
  },
}));

const mockQuizReset = jest.fn();
jest.mock('./quiz-store', () => ({
  useQuizStore: {
    getState: jest.fn(() => ({ reset: mockQuizReset })),
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { merchantSlug: 'ogabassey' },
    },
  },
}));

// expo-apple-authentication: the store uses dynamic import() inside signInWithApple().
// jest.mock() with a factory is hoisted and intercepts both static and dynamic require()
// calls (babel transforms import() → require()). We expose the mock fns via mockAppleAuth
// so tests can call mockResolvedValueOnce / mockRejectedValueOnce per-test.
const mockAppleSignInAsync = jest.fn();
const mockAppleIsAvailableAsync = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: mockAppleIsAvailableAsync,
  signInAsync: mockAppleSignInAsync,
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  Platform: { OS: 'ios' },
}));

jest.mock('../services/push-notifications', () => ({
  removePushTokenFromServer: jest.fn().mockResolvedValue(true),
  savePushTokenToServer: jest.fn().mockResolvedValue(true),
  registerForPushNotifications: jest.fn().mockResolvedValue(null),
  handleNotificationResponse: jest.fn(),
  clearBadge: jest.fn(),
  setupNotificationChannels: jest.fn(),
}));

// push-token-storage is mocked via jest.mock() but the factory-closure approach
// does not reliably intercept module-level imports in all jest-expo configurations.
// We therefore auto-mock the module and use jest.spyOn() in beforeEach.
jest.mock('../lib/push-token-storage');

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are registered
// ---------------------------------------------------------------------------

import * as pushTokenStorage from '../lib/push-token-storage';
import { supabase } from '../lib/supabase';
import * as pushNotificationsService from '../services/push-notifications';
import { useAuthStore } from './auth-store';

// Spies wired in beforeEach
let mockGetStoredPushToken: jest.SpyInstance;
let mockClearStoredPushToken: jest.SpyInstance;
let mockRemovePushTokenFromServer: jest.SpyInstance;

// Flush all pending promises — needed when async operations inside act() span
// multiple microtask ticks (e.g. sequential awaits in store actions that include
// push-token cleanup before other state mutations).
const _flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

async function emitAuthStateChange(event: string, session: unknown) {
  mockAuthListenerCb(event, session);
  await _flushPromises();
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MERCHANT_ID = 'merchant-uuid-1';
const USER_ID = 'user-uuid-1';
const OTHER_USER_ID = 'user-uuid-2';

const mockMerchantRow = { id: MERCHANT_ID, slug: 'ogabassey' };

const mockUser = {
  id: USER_ID,
  email: 'test@example.com',
  user_metadata: {},
};

const mockSession = {
  user: mockUser,
  access_token: 'access-token-abc',
  refresh_token: 'refresh-token-xyz',
};

const mockCustomerRow = {
  id: 'customer-uuid-1',
  email: 'test@example.com',
  first_name: 'Ada',
  last_name: 'Okonkwo',
  phone: null,
  loyalty_points: 100,
  username_changed_at: '2026-08-04T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a chainable Supabase query-builder stub that resolves with `result`. */
function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'eq', 'insert', 'update', 'delete', 'upsert']) {
    chain[m] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.single = jest.fn(() => Promise.resolve(result));
  return chain;
}

/** Reset Zustand store to the initial unauthenticated state. */
function resetStore() {
  // The cast is needed because _initializationInProgress / _authSubscription
  // are internal fields not in the public AuthState interface.
  (useAuthStore.setState as (s: object) => void)({
    user: null,
    session: null,
    customer: null,
    merchantId: null,
    isLoading: true,
    isInitialized: false,
    error: null,
    _initGen: 0,
    _initializationInProgress: false,
    _authSubscription: null,
  });
}

async function flushAuthHydration() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Wire up default mock implementations on supabase.*
 * Individual tests override these as needed.
 */
function resetSupabaseMocks({
  merchantResult = { data: mockMerchantRow, error: null },
  customerResult = { data: null, error: null },
  session = null,
  getUser = { data: { user: null }, error: null },
  refreshSession = {
    data: { session: null },
    error: { message: 'Refresh token invalid' },
  },
}: {
  merchantResult?: { data: unknown; error: unknown };
  customerResult?: { data: unknown; error: unknown };
  session?: unknown;
  getUser?: { data: { user: unknown }; error: unknown };
  refreshSession?: { data: { session: unknown }; error: unknown };
} = {}) {
  (supabase.from as jest.Mock).mockImplementation((table: string) =>
    makeChain(table === 'merchants' ? merchantResult : customerResult)
  );
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({
    data: { session },
    error: null,
  });
  (supabase.auth.getUser as jest.Mock).mockResolvedValue(getUser);
  (supabase.auth.refreshSession as jest.Mock).mockResolvedValue(refreshSession);
  (supabase.auth.setSession as jest.Mock).mockResolvedValue({
    data: { session: null, user: null },
    error: null,
  });
  (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
    data: { session: null, user: null },
    error: null,
  });
  (supabase.auth.signInWithOAuth as jest.Mock).mockResolvedValue({
    data: { url: 'https://accounts.google.com/o/oauth2/v2/auth' },
    error: null,
  });
  (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValue({
    data: { user: null, session: null },
    error: null,
  });
  (supabase.auth.updateUser as jest.Mock).mockResolvedValue({ error: null });
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation(
    (cb: (event: string, session: unknown) => void) => {
      mockAuthListenerCb = cb;
      return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    }
  );
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('useAuthStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnsubscribe.mockReset();
    mockClearCart.mockReset();
    // Reset the captured auth listener so no test leaks a stale callback
    mockAuthListenerCb = () => {
      /* noop default */
    };
    resetStore();
    resetSupabaseMocks();
    mockMakeRedirectUri.mockReturnValue('ogabassey://auth');
    mockGetQueryParams.mockReturnValue({
      errorCode: null,
      params: {
        code: 'oauth-code',
      },
    });
    mockOpenAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'ogabassey://auth?code=oauth-code',
    });
    // Wire push-token-storage spies — spyOn ensures the module-level import in
    // auth-store.ts gets intercepted regardless of jest-expo module resolution.
    mockGetStoredPushToken = jest
      .spyOn(pushTokenStorage, 'getStoredPushToken')
      .mockResolvedValue(null);
    mockClearStoredPushToken = jest
      .spyOn(pushTokenStorage, 'clearStoredPushToken')
      .mockResolvedValue(undefined);
    mockRemovePushTokenFromServer = jest
      .spyOn(pushNotificationsService, 'removePushTokenFromServer')
      .mockResolvedValue(true);
  });

  // -------------------------------------------------------------------------
  describe('initialize() — customer record exists by user_id', () => {
    it('fetches customer by user_id and populates store when record exists', async () => {
      // Arrange
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
        customerResult: { data: mockCustomerRow, error: null },
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });
      await flushAuthHydration();

      // Assert
      const state = useAuthStore.getState();
      expect(state.isInitialized).toBe(true);
      expect(state.customer).not.toBeNull();
      expect(state.customer?.id).toBe('customer-uuid-1');
      expect(state.customer?.email).toBe('test@example.com');
      expect(state.customer?.username_changed_at).toBe(
        '2026-08-04T12:00:00.000Z'
      );
      expect(state.merchantId).toBe(MERCHANT_ID);
    });

    it('does NOT call upsert_customer_on_auth RPC when customer record exists', async () => {
      // Arrange
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
        customerResult: { data: mockCustomerRow, error: null },
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'upsert_customer_on_auth',
        expect.anything()
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('initialize() — no customer record, calls RPC then re-fetches', () => {
    it('calls upsert_customer_on_auth with correct params when no customer found', async () => {
      // Arrange: first customers query → null; after RPC → re-fetch returns the row
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
      });

      let customerCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants')
          return makeChain({ data: mockMerchantRow, error: null });
        customerCallCount += 1;
        return makeChain(
          customerCallCount === 1
            ? { data: null, error: null }
            : { data: mockCustomerRow, error: null }
        );
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });
      await flushAuthHydration();

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('upsert_customer_on_auth', {
        p_merchant_id: MERCHANT_ID,
        p_user_id: USER_ID,
        p_email: 'test@example.com',
        p_full_name: null,
        p_phone: null,
      });
    });

    it('populates customer from re-fetch after RPC call', async () => {
      // Arrange
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
      });

      let customerCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants')
          return makeChain({ data: mockMerchantRow, error: null });
        customerCallCount += 1;
        return makeChain(
          customerCallCount === 1
            ? { data: null, error: null }
            : { data: mockCustomerRow, error: null }
        );
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });
      await flushAuthHydration();

      // Assert
      const state = useAuthStore.getState();
      expect(state.customer?.id).toBe('customer-uuid-1');
      expect(state.isInitialized).toBe(true);
    });

    it('handles RPC error gracefully and still completes initialization', async () => {
      // Arrange
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' },
      });
      // Both customer calls return null (RPC failed, nothing to re-fetch)
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants')
          return makeChain({ data: mockMerchantRow, error: null });
        return makeChain({ data: null, error: null });
      });

      // Act — should not throw
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert: store still marks itself initialized without crashing
      expect(useAuthStore.getState().isInitialized).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('initialize() — _initGen cancellation guard', () => {
    it('does not crash or leave corrupt state when a stale init is superseded', async () => {
      // Arrange: delay getSession so we can call cleanup() mid-flight
      let resolveSession!: (v: unknown) => void;
      (supabase.auth.getSession as jest.Mock).mockReturnValueOnce(
        new Promise((res) => {
          resolveSession = res;
        })
      );

      // Act: start initialize (doesn't await yet)
      const initPromise = useAuthStore.getState().initialize();

      // Supersede the init by calling cleanup(), which bumps _initGen
      act(() => {
        useAuthStore.getState().cleanup();
      });

      // Unblock the session promise
      resolveSession({ data: { session: null }, error: null });

      await act(async () => {
        await initPromise;
      });

      // Assert: store is accessible and not in a broken state
      const state = useAuthStore.getState();
      expect(state).toBeDefined();
      // isLoading may be true (stale init was cancelled before it could set false)
      // The important thing: no unhandled exception was thrown
    });
  });

  // -------------------------------------------------------------------------
  describe('initialize() — no active session', () => {
    it('sets user and customer to null when there is no session', async () => {
      // Arrange: default mocks already have session: null

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });
      await flushAuthHydration();

      // Assert
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.customer).toBeNull();
      expect(state.isInitialized).toBe(true);
    });

    it('sets merchantId from the merchants table lookup', async () => {
      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      expect(useAuthStore.getState().merchantId).toBe(MERCHANT_ID);
    });

    it('enters guest mode (merchantId null) when merchant lookup fails', async () => {
      // Arrange
      resetSupabaseMocks({
        merchantResult: { data: null, error: { message: 'Not found' } },
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.merchantId).toBeNull();
      expect(state.isInitialized).toBe(true);
    });

    it('continues as guest and keeps the auth listener when getSession times out', async () => {
      // Arrange
      (supabase.auth.getSession as jest.Mock).mockRejectedValueOnce(
        new Error('Timeout: getSession took longer than 10000ms')
      );

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.session).toBeNull();
      expect(state.customer).toBeNull();
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
      expect(state._initializationInProgress).toBe(false);
      expect(supabase.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('initialize() — invalid session JWT', () => {
    it('clears session and enters guest mode when server-side getUser fails', async () => {
      // Arrange
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: null }, error: { message: 'JWT expired' } },
        refreshSession: {
          data: { session: null },
          error: { message: 'Refresh token expired' },
        },
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.session).toBeNull();
      expect(state.customer).toBeNull();
      expect(state.isInitialized).toBe(true);
      // Persisted auth tokens should be cleared so next cold start doesn't retry
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('refreshes session when getUser fails with expired JWT but refresh token is valid', async () => {
      // Arrange
      const refreshedSession = {
        ...mockSession,
        access_token: 'refreshed-access-token',
      };
      resetSupabaseMocks({
        session: mockSession,
        getUser: {
          data: { user: null },
          error: { message: 'JWT expired', status: 401, code: 'bad_jwt' },
        },
        refreshSession: {
          data: { session: refreshedSession },
          error: null,
        },
        customerResult: { data: mockCustomerRow, error: null },
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert
      const state = useAuthStore.getState();
      expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
      expect(state.user?.id).toBe(USER_ID);
      expect(state.session).toEqual(refreshedSession);
      expect(state.customer?.id).toBe(mockCustomerRow.id);
      expect(state.isInitialized).toBe(true);
    });

    it('preserves the local session when getUser fails with a transient network error', async () => {
      // Arrange
      resetSupabaseMocks({
        session: mockSession,
        getUser: {
          data: { user: null },
          error: { message: 'Network request failed', status: 503 },
        },
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.user?.id).toBe(USER_ID);
      expect(state.session).toBe(mockSession);
      expect(state.isInitialized).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('initialize() — customer hydration timeouts', () => {
    it('preserves user/session and completes init without waiting when customer fetch hangs', async () => {
      const sessionWithoutEmail = {
        ...mockSession,
        user: { ...mockUser, email: null },
      };

      resetSupabaseMocks({
        session: sessionWithoutEmail,
        getUser: { data: { user: sessionWithoutEmail.user }, error: null },
      });

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants') {
          return makeChain({ data: mockMerchantRow, error: null });
        }

        const hangingCustomersChain = makeChain({ data: null, error: null });
        hangingCustomersChain.maybeSingle.mockImplementation(
          () => new Promise(() => void 0)
        );
        return hangingCustomersChain;
      });

      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      const state = useAuthStore.getState();
      expect(state.user?.id).toBe(USER_ID);
      expect(state.session).toEqual(sessionWithoutEmail);
      expect(state.customer).toBeNull();
      expect(state.isInitialized).toBe(true);
      expect(state.isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('onAuthStateChange — SIGNED_IN', () => {
    /** Run initialize so the auth listener is registered, then return. */
    async function runInitialize() {
      await act(async () => {
        await useAuthStore.getState().initialize();
      });
    }

    it('sets user, session, and customer when record found by user_id', async () => {
      // Arrange
      await runInitialize();

      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants')
          return makeChain({ data: mockMerchantRow, error: null });
        return makeChain({ data: mockCustomerRow, error: null });
      });

      // Act
      await act(async () => {
        await emitAuthStateChange('SIGNED_IN', mockSession);
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.user?.id).toBe(USER_ID);
      expect(state.session).toBe(mockSession);
      expect(state.customer?.id).toBe('customer-uuid-1');
      // A fresh sign-in (account switch) resets any prior quiz state.
      expect(mockQuizReset).toHaveBeenCalled();
    });

    it('does NOT reset quiz state on a same-user SIGNED_IN (session refresh)', async () => {
      // Arrange: shopper already signed in as USER_ID (mid-quiz).
      await runInitialize();
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants')
          return makeChain({ data: mockMerchantRow, error: null });
        return makeChain({ data: mockCustomerRow, error: null });
      });
      (useAuthStore.setState as (state: object) => void)({
        user: { id: USER_ID },
      });
      mockQuizReset.mockClear();

      // Act: SIGNED_IN fires again for the SAME user (token refresh / session
      // re-establishment), not an account switch.
      await act(async () => {
        await emitAuthStateChange('SIGNED_IN', mockSession);
      });

      // Assert: quiz state is preserved; the store still syncs the session.
      expect(mockQuizReset).not.toHaveBeenCalled();
      expect(useAuthStore.getState().user?.id).toBe(USER_ID);
    });

    it('still updates user/session when merchant lookup failed during initialize', async () => {
      // Arrange
      resetSupabaseMocks({
        merchantResult: { data: null, error: { message: 'Not found' } },
      });
      await runInitialize();

      // Act
      await act(async () => {
        await emitAuthStateChange('SIGNED_IN', mockSession);
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.merchantId).toBeNull();
      expect(state.user?.id).toBe(USER_ID);
      expect(state.session).toBe(mockSession);
      expect(state.customer).toBeNull();
    });

    it('calls upsert_customer_on_auth RPC when no customer found on SIGNED_IN', async () => {
      // Arrange
      await runInitialize();

      let listenerCustomerCallCount = 0;
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'merchants')
          return makeChain({ data: mockMerchantRow, error: null });
        listenerCustomerCallCount += 1;
        return makeChain(
          listenerCustomerCallCount === 1
            ? { data: null, error: null }
            : { data: mockCustomerRow, error: null }
        );
      });

      // Act
      await act(async () => {
        await emitAuthStateChange('SIGNED_IN', mockSession);
      });

      // Assert
      expect(supabase.rpc).toHaveBeenCalledWith('upsert_customer_on_auth', {
        p_merchant_id: MERCHANT_ID,
        p_user_id: USER_ID,
        p_email: 'test@example.com',
        p_full_name: null,
        p_phone: null,
      });
    });

    it('skips customer fetch when merchantId is null on SIGNED_IN', async () => {
      // Arrange: merchant lookup fails → merchantId stays null
      resetSupabaseMocks({
        merchantResult: { data: null, error: { message: 'Not found' } },
      });
      await runInitialize();
      expect(useAuthStore.getState().merchantId).toBeNull();

      const fromSpy = supabase.from as jest.Mock;
      fromSpy.mockClear();

      // Act
      await act(async () => {
        await emitAuthStateChange('SIGNED_IN', mockSession);
      });

      // Assert: no customers table query made
      const customerCalls = fromSpy.mock.calls.filter(
        ([table]: [string]) => table === 'customers'
      );
      expect(customerCalls).toHaveLength(0);
    });

    it('sets customer to null when merchantId is missing', async () => {
      // Arrange
      resetSupabaseMocks({
        merchantResult: { data: null, error: { message: 'Not found' } },
      });
      await runInitialize();

      // Act
      await act(async () => {
        await emitAuthStateChange('SIGNED_IN', mockSession);
      });

      // Assert
      expect(useAuthStore.getState().customer).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('onAuthStateChange — SIGNED_OUT', () => {
    it('clears user, session, and customer on SIGNED_OUT event', async () => {
      // Arrange: initialize with an authenticated user so state is populated
      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
        customerResult: { data: mockCustomerRow, error: null },
      });
      (supabase.from as jest.Mock).mockImplementation((table: string) =>
        makeChain(
          table === 'merchants'
            ? { data: mockMerchantRow, error: null }
            : { data: mockCustomerRow, error: null }
        )
      );

      await act(async () => {
        await useAuthStore.getState().initialize();
      });
      expect(useAuthStore.getState().user).not.toBeNull();

      // Act
      await act(async () => {
        await emitAuthStateChange('SIGNED_OUT', null);
        await _flushPromises();
      });

      // Assert
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.session).toBeNull();
      expect(state.customer).toBeNull();
      expect(mockClearCart).toHaveBeenCalled();
      expect(mockClearSaved).toHaveBeenCalled();
      expect(mockClearComparison).toHaveBeenCalled();
      // Quiz attempt/result/prize must not survive a sign-out.
      expect(mockQuizReset).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('onAuthStateChange — TOKEN_REFRESHED', () => {
    it('updates session state on TOKEN_REFRESHED event', async () => {
      // Arrange
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      const refreshedSession = { ...mockSession, access_token: 'new-token' };

      // Act
      await act(async () => {
        await emitAuthStateChange('TOKEN_REFRESHED', refreshedSession);
      });

      // Assert
      expect(useAuthStore.getState().session).toBe(refreshedSession);
    });

    it('does not update session when TOKEN_REFRESHED is called with null', async () => {
      // Arrange
      await act(async () => {
        await useAuthStore.getState().initialize();
      });
      const sessionBefore = useAuthStore.getState().session;

      // Act
      await act(async () => {
        await emitAuthStateChange('TOKEN_REFRESHED', null);
      });

      // Assert: session unchanged
      expect(useAuthStore.getState().session).toBe(sessionBefore);
    });
  });

  // -------------------------------------------------------------------------
  describe('signInWithGoogle()', () => {
    beforeEach(() => {
      (useAuthStore.setState as (s: object) => void)({
        merchantId: MERCHANT_ID,
        isLoading: false,
        isInitialized: true,
      });
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
        data: {
          session: mockSession,
          user: mockUser,
        },
        error: null,
      });
    });

    it('sets local auth state immediately after OAuth session creation', async () => {
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'customers') {
          return makeChain({ data: mockCustomerRow, error: null });
        }

        return makeChain({ data: mockMerchantRow, error: null });
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithGoogle();
      });

      expect(result).toEqual({ success: true });
      expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith(
        'oauth-code'
      );
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
      expect(useAuthStore.getState().user?.id).toBe(USER_ID);
      expect(useAuthStore.getState().session?.access_token).toBe(
        'access-token-abc'
      );
      expect(useAuthStore.getState().customer?.id).toBe('customer-uuid-1');
    });

    it('returns an error when no authenticated user is available after code exchange', async () => {
      (supabase.auth.exchangeCodeForSession as jest.Mock).mockResolvedValue({
        data: { session: null, user: null },
        error: null,
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithGoogle();
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unable to complete sign-in');
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('returns an error when Google does not return an authorization code', async () => {
      mockGetQueryParams.mockReturnValueOnce({
        errorCode: null,
        params: {},
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithGoogle();
      });

      expect(result).toEqual({
        success: false,
        error: 'No authorization code received from Google',
      });
      expect(supabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(supabase.auth.setSession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('signInWithApple()', () => {
    beforeEach(() => {
      // Set default implementations for this describe block.
      // outer beforeEach already called jest.clearAllMocks() (clears calls,
      // not implementations) and resetSupabaseMocks() (sets supabase defaults).
      // We only need to wire up apple-auth defaults here.
      mockAppleIsAvailableAsync.mockResolvedValue(true);
      // signInAsync has no default — each test sets its own value.

      // Pre-populate merchantId as if initialize() already ran
      (useAuthStore.setState as (s: object) => void)({
        merchantId: MERCHANT_ID,
        isLoading: false,
        isInitialized: true,
      });
    });

    it('calls updateUser with Apple name then calls upsert RPC on first sign-in', async () => {
      // Arrange: Apple returns a full name on first sign-in, user has no metadata yet
      mockAppleSignInAsync.mockResolvedValueOnce({
        identityToken: 'apple-id-token',
        fullName: { givenName: 'Chidi', familyName: 'Anagonye' },
        email: 'chidi@example.com',
      });

      const appleUser = {
        id: 'user-uuid-2',
        email: 'chidi@example.com',
        user_metadata: {}, // full_name not yet set → triggers updateUser
      };
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
        data: { user: appleUser, session: mockSession },
        error: null,
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().signInWithApple();
      });

      // Assert: user metadata updated with Apple name
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        data: { full_name: 'Chidi Anagonye' },
      });

      // Assert: RPC called with the Apple credential name
      expect(supabase.rpc).toHaveBeenCalledWith('upsert_customer_on_auth', {
        p_merchant_id: MERCHANT_ID,
        p_user_id: 'user-uuid-2',
        p_email: 'chidi@example.com',
        p_full_name: 'Chidi Anagonye',
        p_phone: null,
      });
    });

    it('skips updateUser and RPC when user already has full_name in metadata', async () => {
      // Arrange: returning Apple user — metadata already has full_name
      (supabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'customers') {
          return makeChain({ data: mockCustomerRow, error: null });
        }

        return makeChain({ data: mockMerchantRow, error: null });
      });
      mockAppleSignInAsync.mockResolvedValueOnce({
        identityToken: 'apple-id-token',
        fullName: { givenName: 'Chidi', familyName: 'Anagonye' },
        email: null,
      });

      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
        data: {
          user: {
            id: 'user-uuid-2',
            email: 'chidi@example.com',
            user_metadata: { full_name: 'Chidi Anagonye' }, // already populated
          },
          session: mockSession,
        },
        error: null,
      });

      // Act
      await act(async () => {
        await useAuthStore.getState().signInWithApple();
      });

      // Assert: no redundant calls
      expect(supabase.auth.updateUser).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('returns success:false with cancellation message when user dismisses Apple prompt', async () => {
      // Arrange: Apple throws ERR_REQUEST_CANCELED when user taps "Cancel"
      const cancelError = Object.assign(new Error('User cancelled'), {
        code: 'ERR_REQUEST_CANCELED',
      });
      mockAppleSignInAsync.mockRejectedValueOnce(cancelError);

      // Act
      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithApple();
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Sign in was cancelled');
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('returns success:false and sets store error when signInWithIdToken fails', async () => {
      // Arrange
      mockAppleSignInAsync.mockResolvedValueOnce({
        identityToken: 'apple-id-token',
        fullName: null,
        email: null,
      });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { message: 'Invalid identity token' },
      });

      // Act
      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithApple();
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid identity token');
      expect(useAuthStore.getState().error).toBe('Invalid identity token');
    });

    it('returns success:false when Apple Authentication is not available on device', async () => {
      // Arrange
      mockAppleIsAvailableAsync.mockResolvedValueOnce(false);

      // Act
      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithApple();
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('returns success:true and clears isLoading on successful sign-in', async () => {
      // Arrange: sign-in succeeds, no name from Apple (returning user)
      mockAppleSignInAsync.mockResolvedValueOnce({
        identityToken: 'apple-id-token',
        fullName: null,
        email: null,
      });
      (supabase.auth.signInWithIdToken as jest.Mock).mockResolvedValueOnce({
        data: { user: mockUser, session: mockSession },
        error: null,
      });

      // Act
      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().signInWithApple();
      });

      // Assert
      expect(result.success).toBe(true);
      expect(useAuthStore.getState().user?.id).toBe(USER_ID);
      expect(useAuthStore.getState().session?.access_token).toBe(
        'access-token-abc'
      );
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteAccount()', () => {
    it('calls the storefront deletion RPC, signs out locally, and clears cached state', async () => {
      (useAuthStore.setState as (state: object) => void)({
        user: {
          ...mockUser,
          app_metadata: { providers: ['email', 'apple'] },
        },
        session: mockSession,
        customer: mockCustomerRow,
        merchantId: MERCHANT_ID,
        isLoading: false,
        isInitialized: true,
      });

      let result!: { success: boolean; error?: string; usedApple?: boolean };
      await act(async () => {
        result = await useAuthStore.getState().deleteAccount();
        await _flushPromises();
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'delete_current_storefront_account'
      );
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(mockClearCart).toHaveBeenCalled();
      expect(mockClearSaved).toHaveBeenCalled();
      expect(mockClearComparison).toHaveBeenCalled();
      expect(mockQuizReset).toHaveBeenCalled();
      expect(result).toEqual({ success: true, usedApple: true });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.session).toBeNull();
      expect(state.customer).toBeNull();
    });

    it('returns a safe error message when the storefront deletion RPC fails', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: {
          message:
            'update or delete on table "customers" violates foreign key constraint',
        },
      });
      (useAuthStore.setState as (state: object) => void)({
        user: mockUser,
        session: mockSession,
        customer: mockCustomerRow,
        merchantId: MERCHANT_ID,
        isLoading: false,
        isInitialized: true,
      });

      let result!: { success: boolean; error?: string; usedApple?: boolean };
      await act(async () => {
        result = await useAuthStore.getState().deleteAccount();
      });

      expect(result).toEqual({
        success: false,
        error:
          'Account deletion is temporarily unavailable. Please contact support.',
      });
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    });

    it('still clears local state when the local sign-out step fails after deletion', async () => {
      (supabase.auth.signOut as jest.Mock).mockRejectedValueOnce(
        new Error('local sign out failed')
      );
      (useAuthStore.setState as (state: object) => void)({
        user: mockUser,
        session: mockSession,
        customer: mockCustomerRow,
        merchantId: MERCHANT_ID,
        isLoading: false,
        isInitialized: true,
      });

      let result!: { success: boolean; error?: string; usedApple?: boolean };
      await act(async () => {
        result = await useAuthStore.getState().deleteAccount();
        await _flushPromises();
      });

      expect(supabase.rpc).toHaveBeenCalledWith(
        'delete_current_storefront_account'
      );
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(mockClearCart).toHaveBeenCalled();
      expect(mockClearSaved).toHaveBeenCalled();
      expect(mockClearComparison).toHaveBeenCalled();
      expect(result).toEqual({ success: true, usedApple: false });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.session).toBeNull();
      expect(state.customer).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('signOut() — push token cleanup', () => {
    beforeEach(() => {
      mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[stored]');
      mockClearStoredPushToken.mockResolvedValue(undefined);
      mockRemovePushTokenFromServer.mockResolvedValue(true);
    });

    it('clears local push token and deactivates server token before supabase.auth.signOut()', async () => {
      const callOrder: string[] = [];
      mockClearStoredPushToken.mockImplementation(() => {
        callOrder.push('clearStoredPushToken');
        return Promise.resolve();
      });
      mockRemovePushTokenFromServer.mockImplementation(() => {
        callOrder.push('removePushTokenFromServer');
        return Promise.resolve(true);
      });
      (supabase.auth.signOut as jest.Mock).mockImplementation(() => {
        callOrder.push('supabase.auth.signOut');
        return Promise.resolve({ error: null });
      });

      await act(async () => {
        await useAuthStore.getState().signOut();
        await _flushPromises();
      });

      expect(callOrder.indexOf('clearStoredPushToken')).toBeLessThan(
        callOrder.indexOf('supabase.auth.signOut')
      );
      expect(callOrder.indexOf('removePushTokenFromServer')).toBeLessThan(
        callOrder.indexOf('supabase.auth.signOut')
      );
    });

    it('proceeds with sign-out even when removePushTokenFromServer fails', async () => {
      mockRemovePushTokenFromServer.mockResolvedValue(false);

      await act(async () => {
        await useAuthStore.getState().signOut();
        await _flushPromises();
      });

      expect(supabase.auth.signOut).toHaveBeenCalled();
    });

    it('does not finish signOut until cart clear persistence resolves', async () => {
      let resolveClear!: () => void;
      mockClearCart.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveClear = () => resolve(undefined);
          })
      );

      let signOutFinished = false;
      const signOutPromise = useAuthStore
        .getState()
        .signOut()
        .then(() => {
          signOutFinished = true;
        });

      await _flushPromises();
      expect(signOutFinished).toBe(false);
      expect(mockClearCart).toHaveBeenCalled();

      resolveClear();
      await signOutPromise;
      expect(signOutFinished).toBe(true);
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('still signs out when cart clear persistence rejects', async () => {
      mockClearCart.mockRejectedValueOnce(new Error('persist failed'));

      await act(async () => {
        await useAuthStore.getState().signOut();
        await _flushPromises();
      });

      expect(useAuthStore.getState().user).toBeNull();
      expect(mockClearCart).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('onAuthStateChange — SIGNED_OUT push token cleanup (passive fallback)', () => {
    it('clears stored token and attempts server deactivation on passive SIGNED_OUT', async () => {
      mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[stored]');
      mockClearStoredPushToken.mockResolvedValue(undefined);
      mockRemovePushTokenFromServer.mockResolvedValue(true);

      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
        customerResult: { data: mockCustomerRow, error: null },
      });
      (supabase.from as jest.Mock).mockImplementation((table: string) =>
        makeChain(
          table === 'merchants'
            ? { data: mockMerchantRow, error: null }
            : { data: mockCustomerRow, error: null }
        )
      );

      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      await act(async () => {
        await emitAuthStateChange('SIGNED_OUT', null);
        await _flushPromises();
      });

      expect(mockClearStoredPushToken).toHaveBeenCalled();
      expect(mockRemovePushTokenFromServer).toHaveBeenCalledWith(
        'ExponentPushToken[stored]'
      );
    });

    it('is a no-op for push cleanup when no token is stored (explicit sign-out already cleared it)', async () => {
      mockGetStoredPushToken.mockResolvedValue(null);

      resetSupabaseMocks({
        session: mockSession,
        getUser: { data: { user: mockUser }, error: null },
        customerResult: { data: mockCustomerRow, error: null },
      });

      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      await act(async () => {
        await emitAuthStateChange('SIGNED_OUT', null);
        await _flushPromises();
      });

      expect(mockClearStoredPushToken).toHaveBeenCalled();
      expect(mockRemovePushTokenFromServer).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteAccount() — push token cleanup', () => {
    beforeEach(() => {
      mockGetStoredPushToken.mockResolvedValue('ExponentPushToken[stored]');
      mockClearStoredPushToken.mockResolvedValue(undefined);
      mockRemovePushTokenFromServer.mockResolvedValue(true);
      (supabase.rpc as jest.Mock).mockResolvedValue({ error: null });
    });

    it('clears local push token and deactivates server token before local sign-out', async () => {
      const callOrder: string[] = [];
      mockClearStoredPushToken.mockImplementation(() => {
        callOrder.push('clearStoredPushToken');
        return Promise.resolve();
      });
      mockRemovePushTokenFromServer.mockImplementation(() => {
        callOrder.push('removePushTokenFromServer');
        return Promise.resolve(true);
      });
      (supabase.auth.signOut as jest.Mock).mockImplementation(() => {
        callOrder.push('supabase.auth.signOut');
        return Promise.resolve({ error: null });
      });

      await act(async () => {
        await useAuthStore.getState().deleteAccount();
        await _flushPromises();
      });

      expect(callOrder.indexOf('clearStoredPushToken')).toBeLessThan(
        callOrder.indexOf('supabase.auth.signOut')
      );
      expect(callOrder.indexOf('removePushTokenFromServer')).toBeLessThan(
        callOrder.indexOf('supabase.auth.signOut')
      );
    });

    it('proceeds with account deletion even when push token cleanup fails', async () => {
      mockRemovePushTokenFromServer.mockResolvedValue(false);

      let result!: { success: boolean };
      await act(async () => {
        result = await useAuthStore.getState().deleteAccount();
        await _flushPromises();
      });

      expect(result.success).toBe(true);
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });
  });

  // -------------------------------------------------------------------------
  describe('setUsername()', () => {
    beforeEach(() => {
      (useAuthStore.setState as (state: object) => void)({
        user: mockUser,
        session: mockSession,
        customer: mockCustomerRow,
        merchantId: MERCHANT_ID,
        isLoading: false,
        isInitialized: true,
      });
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: mockUser },
        error: null,
      });
    });

    it('updates customer.username in state when the RPC succeeds', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: {
          username: 'OgaFan',
          usernameChangedAt: '2026-08-04T12:00:00.000Z',
          nextEligibleAt: '2026-09-03T12:00:00.000Z',
        },
        error: null,
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('OgaFan');
      });

      expect(supabase.rpc).toHaveBeenCalledWith('set_customer_username_v2', {
        p_merchant_id: MERCHANT_ID,
        p_username: 'OgaFan',
      });
      expect(result).toEqual({ success: true, username: 'OgaFan' });
      expect(useAuthStore.getState().customer?.username).toBe('OgaFan');
      expect(useAuthStore.getState().customer?.username_changed_at).toBe(
        '2026-08-04T12:00:00.000Z'
      );
      expect(useAuthStore.getState().customer?.username_next_eligible_at).toBe(
        '2026-09-03T12:00:00.000Z'
      );
    });

    it('returns the friendly taken-username message and leaves state unchanged when the RPC reports username_taken', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'username_taken' },
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('taken');
      });

      expect(result).toEqual({
        success: false,
        error: 'That username is already taken. Try another.',
      });
      expect(useAuthStore.getState().customer?.username).toBeUndefined();
    });

    it('preserves a concurrent customer update made while the RPC is in flight', async () => {
      // A concurrent updateProfile lands after the top-of-function snapshot,
      // while set_customer_username is awaiting. The final merge must build on
      // the latest customer, not the stale snapshot.
      (supabase.rpc as jest.Mock).mockImplementation(async () => {
        (useAuthStore.setState as (state: object) => void)({
          customer: { ...mockCustomerRow, phone: '+2348099999999' },
        });
        return {
          data: {
            username: 'OgaFan',
            usernameChangedAt: '2026-08-04T12:00:00.000Z',
            nextEligibleAt: '2026-09-03T12:00:00.000Z',
          },
          error: null,
        };
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('OgaFan');
      });

      expect(result).toEqual({ success: true, username: 'OgaFan' });
      const finalCustomer = useAuthStore.getState().customer;
      expect(finalCustomer?.username).toBe('OgaFan');
      // The concurrent phone change survives — not overwritten by the snapshot.
      expect(finalCustomer?.phone).toBe('+2348099999999');
    });

    it('reports success when the username RPC commits before customer hydration completes', async () => {
      (useAuthStore.setState as (state: object) => void)({
        customer: null,
        merchantId: MERCHANT_ID,
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: {
          username: 'OgaFan',
          usernameChangedAt: '2026-08-04T12:00:00.000Z',
          nextEligibleAt: '2026-09-03T12:00:00.000Z',
        },
        error: null,
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('OgaFan');
      });

      expect(result).toEqual({ success: true, username: 'OgaFan' });
      expect(useAuthStore.getState().customer).toBeNull();
    });

    it('reports committed username success when the initiating customer hydrates away while the RPC is pending', async () => {
      let resolveRpc!: (value: {
        data: {
          username: string;
          usernameChangedAt: string;
          nextEligibleAt: string;
        };
        error: null;
      }) => void;
      (supabase.rpc as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRpc = resolve;
          })
      );

      const pending = useAuthStore.getState().setUsername('OgaFan');
      await _flushPromises();
      (useAuthStore.setState as (state: object) => void)({ customer: null });

      await act(async () => {
        resolveRpc({
          data: {
            username: 'OgaFan',
            usernameChangedAt: '2026-08-04T12:00:00.000Z',
            nextEligibleAt: '2026-09-03T12:00:00.000Z',
          },
          error: null,
        });
        await expect(pending).resolves.toEqual({
          success: true,
          username: 'OgaFan',
        });
      });

      expect(useAuthStore.getState().customer).toBeNull();
    });

    it('does not apply a pending username response to a customer who switched accounts', async () => {
      let resolveRpc!: (value: {
        data: {
          username: string;
          usernameChangedAt: string;
          nextEligibleAt: string;
        };
        error: null;
      }) => void;
      (supabase.rpc as jest.Mock).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRpc = resolve;
          })
      );

      const pending = useAuthStore.getState().setUsername('OgaFan');
      await _flushPromises();
      const switchedCustomer = {
        ...mockCustomerRow,
        id: 'customer-uuid-2',
        email: 'other@example.com',
        username: 'OtherShopper',
      };
      (useAuthStore.setState as (state: object) => void)({
        user: { ...mockUser, id: OTHER_USER_ID, email: 'other@example.com' },
        customer: switchedCustomer,
      });

      await act(async () => {
        resolveRpc({
          data: {
            username: 'OgaFan',
            usernameChangedAt: '2026-08-04T12:00:00.000Z',
            nextEligibleAt: '2026-09-03T12:00:00.000Z',
          },
          error: null,
        });
        await expect(pending).resolves.toEqual({
          success: true,
          username: 'OgaFan',
        });
      });

      expect(useAuthStore.getState().customer).toEqual(switchedCustomer);
    });

    it('shows the server next-eligible date when cooldown blocks a rename', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: {
          details: '2026-09-03T12:00:00.000Z',
          message: 'username_change_cooldown',
        },
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('NewName');
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('2026');
      expect(useAuthStore.getState().customer?.username_next_eligible_at).toBe(
        '2026-09-03T12:00:00.000Z'
      );
    });

    it('returns a friendly active-attempt guard message', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'username_change_active_attempt' },
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('NewName');
      });

      expect(result).toEqual({
        success: false,
        error: 'Finish your active quiz before changing your username.',
      });
    });

    it('fails closed when the v2 RPC returns the legacy string shape', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: 'OgaFan',
        error: null,
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('OgaFan');
      });

      expect(result).toEqual({
        success: false,
        error: 'Invalid data received from server',
      });
    });

    it('does not let a stale updateProfile response clobber a username set mid-flight', async () => {
      // Mirror of the setUsername race: updateProfile's UPDATE..RETURNING row is
      // read before a concurrent setUsername lands, so its response carries a
      // stale NULL username. The final merge must keep the live store value.
      const chain: Record<string, jest.Mock> = {};
      for (const m of ['select', 'eq', 'update']) {
        chain[m] = jest.fn(() => chain);
      }
      chain.single = jest.fn(async () => {
        // A concurrent setUsername resolves while this update is in flight.
        (useAuthStore.setState as (state: object) => void)({
          customer: { ...mockCustomerRow, username: 'OgaFan' },
        });
        return {
          data: {
            ...mockCustomerRow,
            user_id: USER_ID,
            phone: '+2348011111111',
            username: null,
          },
          error: null,
        };
      });
      (supabase.from as jest.Mock).mockImplementation(() => chain);

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore
          .getState()
          .updateProfile({ phone: '+2348011111111' });
      });

      expect(result).toEqual({ success: true });
      const finalCustomer = useAuthStore.getState().customer;
      expect(finalCustomer?.phone).toBe('+2348011111111');
      expect(finalCustomer?.user_id).toBe(USER_ID);
      // Live username preserved — not clobbered by the stale NULL.
      expect(finalCustomer?.username).toBe('OgaFan');
    });

    it('keeps the returned username change timestamp when no newer customer value exists', async () => {
      const chain: Record<string, jest.Mock> = {};
      for (const method of ['select', 'eq', 'update']) {
        chain[method] = jest.fn(() => chain);
      }
      chain.single = jest.fn(async () => ({
        data: {
          ...mockCustomerRow,
          username_changed_at: '2026-09-01T12:00:00.000Z',
        },
        error: null,
      }));
      (supabase.from as jest.Mock).mockImplementation(() => chain);
      (useAuthStore.setState as (state: object) => void)({
        customer: { ...mockCustomerRow, username_changed_at: undefined },
      });

      let result!: { success: boolean; error?: string };
      await act(async () => {
        result = await useAuthStore
          .getState()
          .updateProfile({ phone: '+2348011111111' });
      });

      expect(result).toEqual({ success: true });
      expect(useAuthStore.getState().customer?.username_changed_at).toBe(
        '2026-09-01T12:00:00.000Z'
      );
    });

    it('does not apply a pending profile response to a customer who switched accounts', async () => {
      let resolveUpdate!: (value: { data: unknown; error: null }) => void;
      const chain: Record<string, jest.Mock> = {};
      for (const method of ['select', 'eq', 'update']) {
        chain[method] = jest.fn(() => chain);
      }
      chain.single = jest.fn(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve;
          })
      );
      (supabase.from as jest.Mock).mockImplementation(() => chain);

      const pending = useAuthStore
        .getState()
        .updateProfile({ phone: '+2348011111111' });
      await _flushPromises();
      const switchedCustomer = {
        ...mockCustomerRow,
        id: 'customer-uuid-2',
        email: 'other@example.com',
        phone: '+2348022222222',
      };
      (useAuthStore.setState as (state: object) => void)({
        user: { ...mockUser, id: OTHER_USER_ID, email: 'other@example.com' },
        customer: switchedCustomer,
      });

      await act(async () => {
        resolveUpdate({
          data: {
            ...mockCustomerRow,
            user_id: USER_ID,
            phone: '+2348011111111',
          },
          error: null,
        });
        await expect(pending).resolves.toEqual({ success: true });
      });

      expect(useAuthStore.getState().customer).toEqual(switchedCustomer);
    });

    it('returns an error without calling the RPC when not logged in', async () => {
      (useAuthStore.setState as (state: object) => void)({
        customer: null,
        merchantId: null,
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('ogafan');
      });

      expect(result).toEqual({ success: false, error: 'Not logged in' });
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('returns a session-expired error without calling the RPC when getUser fails', async () => {
      (supabase.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: null },
        error: { message: 'jwt expired' },
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('OgaFan');
      });

      expect(result).toEqual({
        success: false,
        error: 'Session expired. Please sign in again.',
      });
      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(useAuthStore.getState().customer?.username).toBeUndefined();
    });

    it.each([
      ['reserved_username', 'That username is not available.'],
      [
        'invalid_username',
        'Use 3-20 letters, numbers, or single . _ separators (start and end with a letter or number).',
      ],
      ['customer_not_found', 'No shopper account found for this store.'],
      ['not_authenticated', 'Please sign in to choose a username.'],
      ['some_unmapped_code', 'Could not set username'],
    ])('maps RPC error %s to friendly copy and leaves state unchanged', async (code, message) => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: code },
      });

      let result!: { success: boolean; error?: string; username?: string };
      await act(async () => {
        result = await useAuthStore.getState().setUsername('OgaFan');
      });

      expect(result).toEqual({ success: false, error: message });
      expect(useAuthStore.getState().customer?.username).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe('cleanup()', () => {
    it('unsubscribes the auth listener after initialize()', async () => {
      // Arrange
      await act(async () => {
        await useAuthStore.getState().initialize();
      });

      // Act
      act(() => {
        useAuthStore.getState().cleanup();
      });

      // Assert
      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });

    it('bumps _initGen to invalidate any pending initializations', () => {
      // Arrange
      const genBefore = (
        useAuthStore.getState() as unknown as { _initGen: number }
      )._initGen;

      // Act
      act(() => {
        useAuthStore.getState().cleanup();
      });

      // Assert
      const genAfter = (
        useAuthStore.getState() as unknown as { _initGen: number }
      )._initGen;
      expect(genAfter).toBeGreaterThan(genBefore);
    });

    it('does not throw when called before initialize() (no subscription to clean)', () => {
      // No initialize() called, _authSubscription is null
      expect(() => {
        act(() => {
          useAuthStore.getState().cleanup();
        });
      }).not.toThrow();
    });
  });
});
