/**
 * Supabase Client for React Native
 * Uses platform-appropriate auth persistence
 *
 * 2026 Best Practices:
 * - Publishable keys for public clients
 * - Native storage and process lock for iOS/Android
 * - Browser sessionStorage for Expo web
 * - Network connectivity checks before edge function calls
 */

import { createClient, processLock } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerAuthRefreshLifecycle } from './auth/auth-refresh-lifecycle';
import { authSessionStorage } from './auth/auth-session-storage';
import { getDefaultSupabaseAuthStorageKey } from './auth/supabase-auth-storage-key';
import { createLogger } from './logger';
import { createSupabaseAuthTimeoutFetch } from './supabase-auth-timeout-fetch';

const log = createLogger('Supabase');

type ExpoExtraConfig = {
  supabaseAnonKey?: string;
  supabasePublishableKey?: string;
  supabaseUrl?: string;
};

function getExpoExtraConfig(): ExpoExtraConfig {
  const expoExtra = Constants.expoConfig?.extra;

  if (!expoExtra || typeof expoExtra !== 'object') {
    return {};
  }

  return expoExtra as ExpoExtraConfig;
}

const expoExtra = getExpoExtraConfig();
const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL || expoExtra.supabaseUrl || '';
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  expoExtra.supabasePublishableKey ||
  '';
const legacySupabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || expoExtra.supabaseAnonKey || '';
const supabaseClientKey = supabasePublishableKey || legacySupabaseAnonKey;
const isUsingLegacyAnonKey = !supabasePublishableKey && !!legacySupabaseAnonKey;

function getValidSupabaseUrl(url: string): string {
  try {
    if (!url) {
      return '';
    }

    new URL(url);
    return url;
  } catch {
    return '';
  }
}

const validSupabaseUrl = getValidSupabaseUrl(supabaseUrl);
const hasSupabaseCredentials = Boolean(validSupabaseUrl && supabaseClientKey);

// Runtime warning when Supabase credentials are missing
if (!validSupabaseUrl) {
  console.warn(
    '[Supabase] SUPABASE_URL is not configured. Set EXPO_PUBLIC_SUPABASE_URL or configure extra.supabaseUrl in app.json.'
  );
}
if (!supabaseClientKey) {
  console.warn(
    '[Supabase] SUPABASE_PUBLISHABLE_KEY is not configured. Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY or configure extra.supabasePublishableKey in app.json.'
  );
}

if (isUsingLegacyAnonKey) {
  console.warn(
    '[Supabase] Using legacy anon key fallback; migrate mobile-storefront builds to EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY before end of 2026.'
  );
}

export const supabaseAuthStorageKey = validSupabaseUrl
  ? getDefaultSupabaseAuthStorageKey(validSupabaseUrl)
  : '';

function createMissingCredentialsClient() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(
          '[Supabase] Client accessed without EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
        );
      },
    }
  ) as ReturnType<typeof createClient>;
}

const isServerRuntime = Platform.OS === 'web' && typeof window === 'undefined';
const isNativeRuntime = Platform.OS !== 'web';

const nonServerAuthOptions = {
  storageKey: supabaseAuthStorageKey,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: false,
  flowType: 'pkce' as const,
};

function getBrowserSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function createMemoryAuthStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

export const supabaseAuthStorage = isServerRuntime
  ? undefined
  : isNativeRuntime
    ? authSessionStorage
    : (getBrowserSessionStorage() ?? createMemoryAuthStorage());

const authOptions = isServerRuntime
  ? {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    }
  : isNativeRuntime
    ? {
        ...nonServerAuthOptions,
        storage: supabaseAuthStorage,
        lock: processLock,
      }
    : {
        ...nonServerAuthOptions,
        storage: supabaseAuthStorage,
      };

/**
 * Supabase client instance with platform-appropriate auth storage
 */
const supabaseClient = hasSupabaseCredentials
  ? createClient(validSupabaseUrl, supabaseClientKey, {
      auth: authOptions,
      global: { fetch: createSupabaseAuthTimeoutFetch(fetch) },
    })
  : createMissingCredentialsClient();

if (hasSupabaseCredentials && !isServerRuntime && isNativeRuntime) {
  registerAuthRefreshLifecycle(supabaseClient.auth);
}

export const supabase = supabaseClient;

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return hasSupabaseCredentials;
}

/**
 * Get the current user session
 */
export async function getSession() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) {
    log.error('Error getting session:', error);
    return null;
  }
  return session;
}

/**
 * Get the current user
 */
export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) {
    log.error('Error getting user:', error);
    return null;
  }
  return user;
}

/**
 * Sign out the current user
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    log.error('Error signing out:', error);
    throw error;
  }
}
