import { decodeBase64UrlToUtf8 } from './cart/base64url';
import { sendStorefrontOtp, verifyStorefrontOtp } from './storefront-auth-api';
import { supabase } from './supabase';

const OTHER_ACCOUNT =
  'This code belongs to a different account. Please try again.';
const NOT_CONFIRMED = 'We could not confirm it is you. Please try again.';
const ACCOUNT_CHANGED =
  'You switched accounts while we were checking. Please try again.';
const CHECK_FAILED =
  "We couldn't check your account just now. Please try again.";
const SECOND_FACTOR_REQUIRED =
  'This account uses two-step verification. Please sign out and sign in again with it, then set your PIN.';

/**
 * An emailed code only gives an AAL1 session, and the PIN rule needs AAL2
 * for an account with a verified second factor. This app has no second-
 * factor step, so such an account is told so up front: no code is sent and
 * its current (possibly AAL2) session is never swapped for a weaker one.
 * If the check cannot be made, stop with a retryable error rather than
 * risk swapping a two-step account's session for a weaker one.
 */
async function refuseSecondFactorAccounts() {
  let nextLevel: string | null | undefined;
  try {
    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    nextLevel = data?.nextLevel;
  } catch {
    throw new Error(CHECK_FAILED);
  }
  if (nextLevel === 'aal2') throw new Error(SECOND_FACTOR_REQUIRED);
}

/** The account a Supabase access token was issued for, or null. */
export function accessTokenSubject(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    // No global atob: it is absent in some runtimes.
    const claims: unknown = JSON.parse(decodeBase64UrlToUtf8(payload));
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
  await refuseSecondFactorAccounts();
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
  await refuseSecondFactorAccounts();
  const result = await verifyStorefrontOtp(input.email, input.code);
  if (!result.success) throw new Error(result.error);
  if (accessTokenSubject(result.data.access_token) !== input.expectedUserId)
    throw new Error(OTHER_ACCOUNT);
  // The customer may have signed in to another account while the code was
  // being checked: never switch the app back to the earlier one.
  const { data: current } = await supabase.auth.getSession();
  if (current.session?.user.id !== input.expectedUserId)
    throw new Error(ACCOUNT_CHANGED);
  const { data, error } = await supabase.auth.setSession({
    access_token: result.data.access_token,
    refresh_token: result.data.refresh_token,
  });
  if (error || data.user?.id !== input.expectedUserId)
    throw new Error(NOT_CONFIRMED);
}
