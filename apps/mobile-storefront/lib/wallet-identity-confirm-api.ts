import { sendStorefrontOtp, verifyStorefrontOtp } from './storefront-auth-api';
import { supabase } from './supabase';

const OTHER_ACCOUNT =
  'This code belongs to a different account. Please try again.';
const NOT_CONFIRMED = 'We could not confirm it is you. Please try again.';

/** The account a Supabase access token was issued for, or null. */
export function accessTokenSubject(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const claims: unknown = JSON.parse(atob(padded));
    return typeof claims === 'object' &&
      claims !== null &&
      'sub' in claims &&
      typeof claims.sub === 'string'
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

/** Emails the signed-in customer a 6-digit code (the normal sign-in code). */
export async function sendIdentityCode(email: string): Promise<void> {
  const result = await sendStorefrontOtp(email);
  if (!result.success) throw new Error(result.error);
}

/**
 * Checks the code and swaps in the fresh session it returns, in place: no
 * sign-out, same account. The new session's sign-in time is what the wallet
 * PIN rule reads, so setting or resetting a PIN is allowed right after.
 * The session is only adopted when it is for the account that asked.
 */
export async function confirmIdentityCode(input: {
  email: string;
  code: string;
  expectedUserId: string;
}): Promise<void> {
  const result = await verifyStorefrontOtp(input.email, input.code);
  if (!result.success) throw new Error(result.error);
  if (accessTokenSubject(result.data.access_token) !== input.expectedUserId)
    throw new Error(OTHER_ACCOUNT);
  const { data, error } = await supabase.auth.setSession({
    access_token: result.data.access_token,
    refresh_token: result.data.refresh_token,
  });
  if (error || data.user?.id !== input.expectedUserId)
    throw new Error(NOT_CONFIRMED);
}
