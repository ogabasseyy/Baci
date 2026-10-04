import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createLogger } from '@/lib/logger';
import { getStorefrontStoragePrefix } from '@/lib/storefront-storage-prefix';
import { EmailSchema } from '@/lib/validation';

const log = createLogger('LoginResume');
const LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY = 'auth-login-resume-state';
const AUTH_LOGIN_RESUME_TTL_MS = 10 * 60 * 1000;

// Resolved lazily (never at module scope): getStorefrontStoragePrefix() throws
// for misconfigured hosted/local modes, and importing this module must not be
// able to break login. A throwing prefix resolves to null and every operation
// fails closed (no read, no write, no clear): falling back to the shared
// legacy key would collapse the hosted/local namespace isolation the prefix
// exists to provide. Resume is best-effort, so a null key only means the
// customer re-enters their email — login itself never breaks.
function resolveResumeStorageKey(): string | null {
  try {
    return `${getStorefrontStoragePrefix()}${LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY}`;
  } catch (error) {
    log.warn('Skipping login resume storage: storage prefix unresolved', error);
    return null;
  }
}

export interface AuthLoginResumeState {
  email: string;
  returnTo: string | null;
  step: 'otp';
}

interface StoredAuthLoginResumeState extends AuthLoginResumeState {
  savedAt: number;
}

function readWebStorageValue(key: string): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage.getItem(key);
}

function writeWebStorageValue(key: string, value: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.setItem(key, value);
  }
}

function removeWebStorageValue(key: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem(key);
  }
}

// Reads the resolved key first, then the legacy unprefixed key, so resume
// state saved before the storage-prefix migration (10-minute TTL) survives an
// upgrade instead of dropping a mid-OTP resume. A legacy hit is migrated to
// the resolved key and deleted immediately: the shared legacy key must not
// linger where a later read under another tenant/mode prefix could surface it.
function readWebResumeValue(primaryKey: string): string | null {
  const rawValue = readWebStorageValue(primaryKey);
  if (rawValue !== null || primaryKey === LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY) {
    return rawValue;
  }
  const legacyValue = readWebStorageValue(LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY);
  if (legacyValue !== null) {
    writeWebStorageValue(primaryKey, legacyValue);
    removeWebStorageValue(LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY);
  }
  return legacyValue;
}

async function readNativeResumeValue(primaryKey: string): Promise<string | null> {
  const rawValue = await SecureStore.getItemAsync(primaryKey);
  if (rawValue !== null || primaryKey === LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY) {
    return rawValue;
  }
  const legacyValue = await SecureStore.getItemAsync(
    LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY
  );
  if (legacyValue !== null) {
    await SecureStore.setItemAsync(primaryKey, legacyValue);
    await SecureStore.deleteItemAsync(LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY);
  }
  return legacyValue;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const charCode = value.charCodeAt(index);
    if (charCode <= 0x1f || charCode === 0x7f) {
      return true;
    }
  }

  return false;
}

function hasScheme(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:/iu.test(value);
}

export function isSafeRelativeReturnTo(value: string | null): boolean {
  if (value === null) {
    return true;
  }

  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    hasControlCharacters(value) ||
    hasScheme(value)
  ) {
    return false;
  }

  try {
    const decodedValue = decodeURIComponent(value);
    return (
      decodedValue.startsWith('/') &&
      !decodedValue.startsWith('//') &&
      !decodedValue.includes('\\') &&
      !hasControlCharacters(decodedValue) &&
      !hasScheme(decodedValue)
    );
  } catch {
    return false;
  }
}

function parseValidAuthLoginResumeState(
  rawValue: string | null
): AuthLoginResumeState | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredAuthLoginResumeState>;
    if (
      parsed.step !== 'otp' ||
      typeof parsed.email !== 'string' ||
      !EmailSchema.safeParse(parsed.email).success ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null;
    }

    const now = Date.now();
    if (
      parsed.savedAt > now ||
      now - parsed.savedAt > AUTH_LOGIN_RESUME_TTL_MS
    ) {
      return null;
    }

    const storedReturnTo =
      typeof parsed.returnTo === 'string' ? parsed.returnTo : null;
    if (!isSafeRelativeReturnTo(storedReturnTo)) {
      return null;
    }

    return {
      email: parsed.email,
      returnTo: storedReturnTo,
      step: 'otp',
    };
  } catch {
    return null;
  }
}

function parseStoredAuthLoginResumeState(
  rawValue: string | null,
  expectedReturnTo: string | null
): AuthLoginResumeState | null {
  const resumeState = parseValidAuthLoginResumeState(rawValue);
  if (
    !resumeState ||
    resumeState.returnTo !== expectedReturnTo ||
    !isSafeRelativeReturnTo(expectedReturnTo)
  ) {
    return null;
  }

  return resumeState;
}

export async function saveAuthLoginResumeState(
  state: AuthLoginResumeState
): Promise<void> {
  const serializedState = JSON.stringify({
    ...state,
    savedAt: Date.now(),
  } satisfies StoredAuthLoginResumeState);

  try {
    const storageKey = resolveResumeStorageKey();
    if (storageKey === null) {
      return;
    }
    if (Platform.OS === 'web') {
      writeWebStorageValue(storageKey, serializedState);
      return;
    }

    await SecureStore.setItemAsync(storageKey, serializedState);
  } catch (error) {
    log.warn('Failed to save pending login resume state', error);
  }
}

export async function getAuthLoginResumeState(
  expectedReturnTo: string | null
): Promise<AuthLoginResumeState | null> {
  try {
    const storageKey = resolveResumeStorageKey();
    if (storageKey === null) {
      return null;
    }
    const rawValue =
      Platform.OS === 'web'
        ? readWebResumeValue(storageKey)
        : await readNativeResumeValue(storageKey);
    return parseStoredAuthLoginResumeState(rawValue, expectedReturnTo);
  } catch (error) {
    log.warn('Failed to read pending login resume state', error);
    return null;
  }
}

export async function getPendingAuthLoginResumeState(): Promise<AuthLoginResumeState | null> {
  try {
    const storageKey = resolveResumeStorageKey();
    if (storageKey === null) {
      return null;
    }
    const rawValue =
      Platform.OS === 'web'
        ? readWebResumeValue(storageKey)
        : await readNativeResumeValue(storageKey);
    return parseValidAuthLoginResumeState(rawValue);
  } catch (error) {
    log.warn('Failed to read pending login resume state', error);
    return null;
  }
}

export async function clearAuthLoginResumeState(): Promise<void> {
  try {
    const storageKey = resolveResumeStorageKey();
    if (storageKey === null) {
      return;
    }
    if (Platform.OS === 'web') {
      removeWebStorageValue(storageKey);
      if (storageKey !== LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY) {
        removeWebStorageValue(LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY);
      }
      return;
    }

    await SecureStore.deleteItemAsync(storageKey);
    if (storageKey !== LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY) {
      await SecureStore.deleteItemAsync(LEGACY_AUTH_LOGIN_RESUME_STORAGE_KEY);
    }
  } catch (error) {
    log.warn('Failed to clear pending login resume state', error);
  }
}
