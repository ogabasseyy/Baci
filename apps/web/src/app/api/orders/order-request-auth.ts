import { NextResponse } from 'next/server';
import { type AuthResult, authenticateApiRequest } from '@/lib/api-auth';

/** An explicit recovery must establish the current user, including a verified guest. */
export async function authenticateOrderRequest(
  request: Request
): Promise<
  | { ok: true; auth: AuthResult; requireRecoveryProof: boolean }
  | { ok: false; response: NextResponse }
> {
  const requireRecoveryProof =
    request.headers.get('x-checkout-recovery') === '1';
  const auth = requireRecoveryProof
    ? await authenticateApiRequest(request, { requireVerifiedGuest: true })
    : await authenticateApiRequest(request);
  if (
    requireRecoveryProof &&
    auth.error &&
    auth.error !== 'Not authenticated'
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unable to verify this checkout. Please try again.' },
        { status: 503 }
      ),
    };
  }
  return { ok: true, auth, requireRecoveryProof };
}
