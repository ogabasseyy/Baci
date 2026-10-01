import type { Session, User } from '@supabase/supabase-js';
import { expect, vi } from 'vitest';

const authStoreMocks = vi.hoisted(() => ({
  captureMobileSignupLifecycle: vi.fn().mockResolvedValue(undefined),
  checkPasswordBreach: vi.fn(async () => ({ isBreached: false })),
  clearAdminQueryCache: vi.fn(),
  getClaims: vi.fn(),
  generateUUID: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
  resetSettings: vi.fn(),
  revenueCleanup: vi.fn(),
  signInWithAppleNative: vi.fn(),
  signInWithGoogleNative: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  trackAuthTelemetry: vi.fn(),
  removeAuthStorageKeys: vi.fn(),
  verifyOtp: vi.fn(),
}));

export const mocks = authStoreMocks;

vi.mock('@/lib/auth/check-password-breach', () => ({
  checkPasswordBreach: authStoreMocks.checkPasswordBreach,
}));

vi.mock('@/lib/query-client', () => ({
  clearAdminQueryCache: authStoreMocks.clearAdminQueryCache,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: authStoreMocks.getSession,
      getClaims: authStoreMocks.getClaims,
      getUser: authStoreMocks.getUser,
      onAuthStateChange: authStoreMocks.onAuthStateChange,
      signInWithPassword: authStoreMocks.signInWithPassword,
      signOut: authStoreMocks.signOut,
      signUp: authStoreMocks.signUp,
      verifyOtp: authStoreMocks.verifyOtp,
    },
  },
  supabaseAuthStorageKey: 'sb-test-auth-token',
}));

vi.mock('@/lib/auth/auth-session-storage', () => ({
  removeAuthStorageKeys: authStoreMocks.removeAuthStorageKeys,
}));

vi.mock('@/utils/uuid', () => ({
  generateUUID: authStoreMocks.generateUUID,
}));

vi.mock('@/lib/auth/sign-in-with-apple', () => ({
  signInWithAppleNative: authStoreMocks.signInWithAppleNative,
}));

vi.mock('@/lib/auth/sign-in-with-google', () => ({
  signInWithGoogleNative: authStoreMocks.signInWithGoogleNative,
}));

vi.mock('@/stores/revenueCatStore', () => ({
  useRevenueCatStore: {
    getState: () => ({
      cleanup: authStoreMocks.revenueCleanup,
    }),
  },
}));

vi.mock('@/services/auth-telemetry', () => ({
  trackAuthTelemetry: authStoreMocks.trackAuthTelemetry,
}));

vi.mock('@/services/signup-lifecycle-telemetry', () => ({
  captureMobileSignupLifecycle: authStoreMocks.captureMobileSignupLifecycle,
}));

vi.mock('@/hooks/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      reset: authStoreMocks.resetSettings,
    }),
  },
}));

export function createSession(userId = 'user-1'): Session {
  const user: User = {
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
    aud: 'authenticated',
    created_at: '2026-03-24T00:00:00.000Z',
    id: userId,
    user_metadata: {},
  };

  return {
    access_token: `access-token-${userId}`,
    expires_at: 1_900_000_000,
    expires_in: 3600,
    refresh_token: `refresh-token-${userId}`,
    token_type: 'bearer',
    user,
  };
}

export function createSignedOutAuthState() {
  return {
    activeAuthProvider: null,
    isAuthenticating: false,
    isAuthenticated: false,
    isInitialized: true,
    isLoading: false,
    session: null,
    user: null,
  };
}

export function createInitializingAuthState() {
  return {
    ...createSignedOutAuthState(),
    isInitialized: false,
    isLoading: true,
  };
}

export function createSignedInAuthState(session = createSession()) {
  return {
    ...createSignedOutAuthState(),
    isAuthenticated: true,
    session,
    user: session.user,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

export type AuthStateChangeCallback = (
  event: string,
  session: Session | null
) => void;

export function getAuthStateChangeCallback(): AuthStateChangeCallback {
  const calls = mocks.onAuthStateChange.mock.calls as unknown as [
    AuthStateChangeCallback,
  ][];
  const callback = calls.at(-1)?.[0];

  expect(callback).toBeDefined();
  return callback as AuthStateChangeCallback;
}
