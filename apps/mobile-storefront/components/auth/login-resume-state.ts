import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createLogger } from '@/lib/logger';
import { getStorefrontStoragePrefix } from '@/lib/storefront-storage-prefix';
import { EmailSchema } from '@/lib/validation';

const log = createLogger('LoginResume');
const AUTH_LOGIN_RESUME_STORAGE_KEY = `${getStorefrontStoragePrefix()}auth-login-resume-state`;
const AUTH_LOGIN_RESUME_TTL_MS = 10 * 60 * 1000;

export interface AuthLoginResumeState {
  email: string;
  returnTo: string | null;
  step: 'otp';
}

interface StoredAuthLoginResumeState extends AuthLoginResumeState {
  savedAt: number;
}

function readWebStorageValue(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage.getItem(AUTH_LOGIN_RESUME_STORAGE_KEY);
}

function writeWebStorageValue(value: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.setItem(AUTH_LOGIN_RESUME_STORAGE_KEY, value);
  }
}

function removeWebStorageValue() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem(AUTH_LOGIN_RESUME_STORAGE_KEY);
  }
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
    if (Platform.OS === 'web') {
      writeWebStorageValue(serializedState);
      return;
    }

    await SecureStore.setItemAsync(
      AUTH_LOGIN_RESUME_STORAGE_KEY,
      serializedState
    );
  } catch (error) {
    log.warn('Failed to save pending login resume state', error);
  }
}

export async function getAuthLoginResumeState(
  expectedReturnTo: string | null
): Promise<AuthLoginResumeState | null> {
  try {
    const rawValue =
      Platform.OS === 'web'
        ? readWebStorageValue()
        : await SecureStore.getItemAsync(AUTH_LOGIN_RESUME_STORAGE_KEY);
    return parseStoredAuthLoginResumeState(rawValue, expectedReturnTo);
  } catch (error) {
    log.warn('Failed to read pending login resume state', error);
    return null;
  }
}

export async function getPendingAuthLoginResumeState(): Promise<AuthLoginResumeState | null> {
  try {
    const rawValue =
      Platform.OS === 'web'
        ? readWebStorageValue()
        : await SecureStore.getItemAsync(AUTH_LOGIN_RESUME_STORAGE_KEY);
    return parseValidAuthLoginResumeState(rawValue);
  } catch (error) {
    log.warn('Failed to read pending login resume state', error);
    return null;
  }
}

export async function clearAuthLoginResumeState(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      removeWebStorageValue();
      return;
    }

    await SecureStore.deleteItemAsync(AUTH_LOGIN_RESUME_STORAGE_KEY);
  } catch (error) {
    log.warn('Failed to clear pending login resume state', error);
  }
}
