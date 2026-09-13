import Constants from 'expo-constants';
import { z } from 'zod';
import { resolveApiBaseUrl } from '@/lib/api-url';
import {
  supabase,
  supabaseAuthStorage,
  supabaseAuthStorageKey,
} from '@/lib/supabase';
import { resolveCheckoutAuth } from './orders-auth';
import { getCheckoutStoredSession } from './orders-session';
import { readCheckoutStoredSession } from './read-checkout-stored-session';

const API_URL = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
);

const availabilitySchema = z.object({
  available: z.literal(true),
  reason: z.string(),
});

const verificationSchema = z.object({
  success: z.literal(true).optional(),
  status: z.string().optional(),
  code: z.string().optional(),
  orderNumber: z.string().optional(),
});

export async function getCheckoutAuthorizationHeaders() {
  const initialSession = await readCheckoutStoredSession(
    supabaseAuthStorage,
    supabaseAuthStorageKey
  );
  const auth = await resolveCheckoutAuth(
    supabase.auth,
    initialSession.session,
    undefined,
    () => getCheckoutStoredSession(supabaseAuthStorage, supabaseAuthStorageKey)
  );
  return auth.authorizationHeaders;
}

export async function getRedvaultPaymentAvailability(merchantId: string) {
  try {
    if (merchantId !== '6b5cb8a4-5575-456c-b936-8cdfae30db74') return false;
    const authorizationHeaders = await getCheckoutAuthorizationHeaders();
    const url = new URL('/api/payments/redvault/availability', API_URL);
    url.searchParams.set('merchant_id', merchantId);
    const response = await fetch(url, {
      headers: authorizationHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    return availabilitySchema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

export async function verifyRedvaultPayment(reference: string) {
  const authorizationHeaders = await getCheckoutAuthorizationHeaders();
  if (!authorizationHeaders.Authorization) {
    const csrfResponse = await fetch(`${API_URL}/api/csrf`, {
      credentials: 'include',
      signal: AbortSignal.timeout(10000),
    });
    const csrf: unknown = await csrfResponse.json();
    if (
      !csrfResponse.ok ||
      !csrf ||
      typeof csrf !== 'object' ||
      !('token' in csrf) ||
      typeof csrf.token !== 'string'
    )
      throw new Error('Unable to confirm payment');
    authorizationHeaders['x-csrf-token'] = csrf.token;
  }
  const response = await fetch(`${API_URL}/api/payments/verify`, {
    method: 'POST',
    credentials: 'include',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...authorizationHeaders },
    body: JSON.stringify({ reference }),
  });
  const body = verificationSchema.safeParse(await response.json()).data;

  if (response.status === 202 && body?.code === 'REDVAULT_CAPTURE_HELD')
    return 'held' as const;
  if (response.status === 202 || body?.status === 'pending') {
    return 'pending' as const;
  }
  if (!response.ok || body?.success !== true || body.status !== 'success') {
    throw new Error('REDVAULT payment verification is incomplete');
  }
  return { status: 'success' as const, orderNumber: body.orderNumber };
}
