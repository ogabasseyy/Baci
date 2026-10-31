// biome-ignore-all lint/correctness/noUndeclaredVariables: Jest globals are provided by jest-expo in this legacy store test.
jest.mock('expo-secure-store');

/**
 * Tests for auth-store — focused on OAuth checkout fix behaviors:
 * - Customer lookup by user_id (not email)
 * - upsert_customer_on_auth RPC fallback
 * - _initGen cancellation guard
 * - onAuthStateChange event handling
 * - signInWithApple name upsert + cancellation
 * - cleanup() unsubscribes auth listener
 */

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

jest.mock('../lib/auth/oauth-query-params', () => ({
  getOAuthQueryParams: (input: string) => mockGetQueryParams(input),
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

const mockClearCart = jest.fn();
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
let _mockGetStoredPushToken: jest.SpyInstance;
let _mockClearStoredPushToken: jest.SpyInstance;
let _mockRemovePushTokenFromServer: jest.SpyInstance;

// Flush all pending promises — needed when async operations inside act() span
// multiple microtask ticks (e.g. sequential awaits in store actions that include
// push-token cleanup before other state mutations).
const _flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

async function _emitAuthStateChange(event: string, session: unknown) {
  mockAuthListenerCb(event, session);
  await _flushPromises();
}

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MERCHANT_ID = 'merchant-uuid-1';
const USER_ID = 'user-uuid-1';

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

async function _flushAuthHydration() {
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
    _mockGetStoredPushToken = jest
      .spyOn(pushTokenStorage, 'getStoredPushToken')
      .mockResolvedValue(null);
    _mockClearStoredPushToken = jest
      .spyOn(pushTokenStorage, 'clearStoredPushToken')
      .mockResolvedValue(undefined);
    _mockRemovePushTokenFromServer = jest
      .spyOn(pushNotificationsService, 'removePushTokenFromServer')
      .mockResolvedValue(true);
  });
  describe('setDateOfBirth()', () => {
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

    it('updates customer.date_of_birth in state when the RPC succeeds', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: '1990-06-15',
        error: null,
      });

      let result!: { success: boolean; error?: string; dateOfBirth?: string };
      await act(async () => {
        result = await useAuthStore.getState().setDateOfBirth('1990-06-15');
      });

      expect(supabase.rpc).toHaveBeenCalledWith('set_customer_date_of_birth', {
        p_merchant_id: MERCHANT_ID,
        p_date_of_birth: '1990-06-15',
      });
      expect(result).toEqual({ success: true, dateOfBirth: '1990-06-15' });
      expect(useAuthStore.getState().customer?.date_of_birth).toBe(
        '1990-06-15'
      );
    });

    it('preserves a concurrent customer update made while the RPC is in flight', async () => {
      // A concurrent updateProfile lands after the top-of-function snapshot
      // while set_customer_date_of_birth is awaiting; the final merge must build
      // on the latest customer, not the stale snapshot.
      (supabase.rpc as jest.Mock).mockImplementation(async () => {
        (useAuthStore.setState as (state: object) => void)({
          customer: { ...mockCustomerRow, phone: '+2348099999999' },
        });
        return { data: '1990-06-15', error: null };
      });

      let result!: { success: boolean; error?: string; dateOfBirth?: string };
      await act(async () => {
        result = await useAuthStore.getState().setDateOfBirth('1990-06-15');
      });

      expect(result).toEqual({ success: true, dateOfBirth: '1990-06-15' });
      const finalCustomer = useAuthStore.getState().customer;
      expect(finalCustomer?.date_of_birth).toBe('1990-06-15');
      expect(finalCustomer?.phone).toBe('+2348099999999');
    });

    it('saves via the RPC when the local customer row has not hydrated', async () => {
      // Post-auth hydration failed, leaving customer null. The RPC re-derives
      // identity server-side, so the save must still succeed (the shopper can
      // then pass the server age gate) rather than dead-ending on "Not logged in".
      (useAuthStore.setState as (state: object) => void)({ customer: null });
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: '1990-06-15',
        error: null,
      });

      let result!: { success: boolean; error?: string; dateOfBirth?: string };
      await act(async () => {
        result = await useAuthStore.getState().setDateOfBirth('1990-06-15');
      });

      expect(supabase.rpc).toHaveBeenCalledWith('set_customer_date_of_birth', {
        p_merchant_id: MERCHANT_ID,
        p_date_of_birth: '1990-06-15',
      });
      expect(result).toEqual({ success: true, dateOfBirth: '1990-06-15' });
      // No local row to patch — must not crash or fabricate a customer.
      expect(useAuthStore.getState().customer).toBeNull();
    });

    it.each([
      ['invalid_date_of_birth', 'Enter a valid date of birth.'],
      ['customer_not_found', 'No shopper account found for this store.'],
      ['not_authenticated', 'Please sign in to continue.'],
      ['some_unmapped_code', 'Could not save date of birth'],
    ])('maps RPC error %s to friendly copy and leaves state unchanged', async (code, message) => {
      // Seed a known DOB so the assertion proves the stored value is PRESERVED
      // on error, not merely absent.
      (useAuthStore.setState as (state: object) => void)({
        customer: { ...mockCustomerRow, date_of_birth: '1980-01-01' },
      });
      (supabase.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: code },
      });

      let result!: { success: boolean; error?: string; dateOfBirth?: string };
      await act(async () => {
        result = await useAuthStore.getState().setDateOfBirth('1990-06-15');
      });

      expect(result).toEqual({ success: false, error: message });
      expect(useAuthStore.getState().customer?.date_of_birth).toBe(
        '1980-01-01'
      );
    });
  });
});
