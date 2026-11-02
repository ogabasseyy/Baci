import { EXPO_PUBLIC_API_URL } from '@/env';
import { resolveApiBaseUrl } from './api-url';
import { CONFIG } from './config';
import { getHostedStorefrontOtpClient } from './get-hosted-storefront-otp-client';

type JsonRecord = Record<string, unknown>;

export type NativeOtpSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
};

export type StorefrontAuthApiResult<T = undefined> =
  | { data: T; success: true }
  | { error: string; success: false };

const API_BASE_URL = resolveApiBaseUrl(EXPO_PUBLIC_API_URL);
const AUTH_REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function readError(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;

  const error = payload.error;
  if (typeof error === 'string' && error.trim()) return error;

  const message = payload.message;
  if (typeof message === 'string' && message.trim()) return message;

  return fallback;
}

function readNativeSession(payload: unknown): NativeOtpSession | null {
  if (!isRecord(payload) || !isRecord(payload.session)) return null;

  const { access_token, refresh_token, expires_at, expires_in, token_type } =
    payload.session;

  if (typeof access_token !== 'string' || typeof refresh_token !== 'string') {
    return null;
  }

  return {
    access_token,
    refresh_token,
    expires_at: typeof expires_at === 'number' ? expires_at : undefined,
    expires_in: typeof expires_in === 'number' ? expires_in : undefined,
    token_type: typeof token_type === 'string' ? token_type : undefined,
  };
}

async function postStorefrontAuth<T>(
  path: '/api/storefront/auth/send-code' | '/api/storefront/auth/verify-code',
  body: JsonRecord,
  parser: (payload: unknown) => T | null,
  fallbackError: string
): Promise<StorefrontAuthApiResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    AUTH_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { success: false, error: fallbackError };
    }

    if (!response.ok) {
      return { success: false, error: readError(payload, fallbackError) };
    }

    const data = parser(payload);
    if (data === null) {
      return { success: false, error: fallbackError };
    }

    return { success: true, data };
  } catch (error) {
    if (isAbortError(error)) {
      return {
        success: false,
        error: 'Request timed out. Please try again.',
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : fallbackError,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendStorefrontOtp(
  email: string
): Promise<StorefrontAuthApiResult> {
  try {
    const client = getHostedStorefrontOtpClient();
    if (client) {
      const { error } = await client.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      return error
        ? { success: false, error: error.message }
        : { success: true, data: undefined };
    }
  } catch {
    return {
      success: false,
      error: 'Could not send your sign-in code. Please try again.',
    };
  }
  return postStorefrontAuth(
    '/api/storefront/auth/send-code',
    {
      audience: 'native',
      email,
      merchantSlug: CONFIG.MERCHANT_SLUG,
    },
    () => undefined,
    'Failed to send OTP'
  );
}

export async function verifyStorefrontOtp(
  email: string,
  token: string
): Promise<StorefrontAuthApiResult<NativeOtpSession>> {
  try {
    const client = getHostedStorefrontOtpClient();
    if (client) {
      const { data, error } = await client.verifyOtp({
        email,
        token,
        type: 'email',
      });
      if (error) return { success: false, error: error.message };
      const session = readNativeSession({ session: data.session });
      return session
        ? { success: true, data: session }
        : { success: false, error: 'Failed to verify OTP' };
    }
  } catch {
    return {
      success: false,
      error: 'Could not verify your sign-in code. Please try again.',
    };
  }
  return postStorefrontAuth(
    '/api/storefront/auth/verify-code',
    {
      audience: 'native',
      email,
      merchantSlug: CONFIG.MERCHANT_SLUG,
      token,
    },
    readNativeSession,
    'Failed to verify OTP'
  );
}
