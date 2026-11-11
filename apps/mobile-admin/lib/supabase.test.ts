// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  authSessionStorage: {
    getItem: vi.fn(),
    removeItem: vi.fn(),
    setItem: vi.fn(),
  },
  createClient: vi.fn(),
  expoExtra: {} as {
    supabaseAnonKey?: string;
    supabasePublishableKey?: string;
    supabaseUrl?: string;
  },
  processLock: vi.fn(),
  registerAuthRefreshLifecycle: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      get extra() {
        return testState.expoExtra;
      },
    },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: testState.createClient,
  processLock: testState.processLock,
}));

vi.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
  },
}));

vi.mock('./auth/auth-refresh-lifecycle', () => ({
  registerAuthRefreshLifecycle: testState.registerAuthRefreshLifecycle,
}));

vi.mock('./auth/auth-session-storage', () => ({
  authSessionStorage: testState.authSessionStorage,
  getDefaultSupabaseAuthStorageKey: (supabaseUrl: string) => {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    return `sb-${projectRef}-auth-token`;
  },
}));

vi.mock('./storage', () => ({
  storage: {
    getString: vi.fn(),
    remove: vi.fn(),
    set: vi.fn(),
  },
}));

describe('supabase client config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    testState.expoExtra = {
      supabaseAnonKey: 'expo-anon-key',
      supabasePublishableKey: 'expo-publishable-key',
      supabaseUrl: 'https://expo-project.supabase.co',
    };
    testState.createClient.mockReturnValue({
      auth: { startAutoRefresh: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('falls back to expo extra publishable config when EXPO_PUBLIC env vars are empty', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', '');

    await import('./supabase');

    expect(testState.createClient).toHaveBeenCalledWith(
      'https://expo-project.supabase.co',
      'expo-publishable-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: true,
          detectSessionInUrl: false,
          lock: testState.processLock,
          persistSession: true,
          storage: testState.authSessionStorage,
        }),
      })
    );
  });

  it('prefers EXPO_PUBLIC publishable key over all fallbacks', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://env-project.supabase.co');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'env-publishable-key');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'env-anon-key');

    await import('./supabase');

    expect(testState.createClient).toHaveBeenCalledWith(
      'https://env-project.supabase.co',
      'env-publishable-key',
      expect.any(Object)
    );
  });

  it('temporarily falls back to the legacy anon key with a warning', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://env-project.supabase.co');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'env-anon-key');
    testState.expoExtra = {
      supabaseAnonKey: 'expo-anon-key',
      supabaseUrl: 'https://expo-project.supabase.co',
    };
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    await import('./supabase');

    expect(testState.createClient).toHaveBeenCalledWith(
      'https://env-project.supabase.co',
      'env-anon-key',
      expect.any(Object)
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[Supabase] Using legacy anon key fallback; migrate mobile-admin builds to EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY before end of 2026.'
    );

    warnSpy.mockRestore();
  });

  it('registers the native auth refresh lifecycle once the client is created', async () => {
    const auth = { startAutoRefresh: vi.fn(), stopAutoRefresh: vi.fn() };
    testState.createClient.mockReturnValue({ auth });

    await import('./supabase');

    expect(testState.registerAuthRefreshLifecycle).toHaveBeenCalledWith(auth);
  });

  it('does not configure a migrated storage key before the storage migration PR', async () => {
    await import('./supabase');

    const createClientOptions = testState.createClient.mock.calls[0]?.[2];
    expect(createClientOptions.auth).not.toHaveProperty('storageKey');
  });

  it('disables persisted auth storage during server rendering', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://env-project.supabase.co');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'env-publishable-key');
    vi.stubGlobal('window', undefined);

    await import('./supabase');

    expect(testState.createClient).toHaveBeenCalledWith(
      'https://env-project.supabase.co',
      'env-publishable-key',
      expect.objectContaining({
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      })
    );

    vi.unstubAllGlobals();
  });

  it('logs a critical error and skips createClient when credentials are missing', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', '');
    testState.expoExtra = {};
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await import('./supabase');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Supabase] CRITICAL: Supabase URL or publishable key is missing from environment variables.'
    );
    expect(testState.createClient).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('logs a critical error and skips createClient when the Supabase URL is invalid', async () => {
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'not-a-url');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'env-publishable-key');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', '');
    testState.expoExtra = {};
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await import('./supabase');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Supabase] CRITICAL: Supabase URL or publishable key is missing from environment variables.'
    );
    expect(testState.createClient).not.toHaveBeenCalled();
    expect(testState.registerAuthRefreshLifecycle).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
