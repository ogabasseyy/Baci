import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { buildGoalPinBinding } from '@/lib/piggyvest/goal-pin-binding';
import { verifyGoalPin } from '@/lib/piggyvest/goal-pin-verify';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import {
  readPrimaryWalletSavingsRecoveryRuntime,
  readPrimaryWalletSavingsRuntime,
} from '@/lib/piggyvest/primary-wallet-savings-runtime';
import { piggyvestGoalPinSchemas } from '@/schemas/piggyvest-goal-pin';

const NO_STORE = { 'Cache-Control': 'no-store' };

function refuse(error: string, code: string, status: number, extra = {}) {
  return NextResponse.json(
    { error, code, ...extra },
    { status, headers: NO_STORE }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return refuse('Please sign in again.', 'UNAUTHORIZED', 401);
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return (
      csrf.response ??
      refuse('Please refresh and try again.', 'CSRF_FAILED', 403)
    );
  const parsed = piggyvestGoalPinSchemas.verifyRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return refuse('Please enter a valid PIN.', 'INVALID_INPUT', 400);
  const input = parsed.data;
  try {
    // Cancel back to the main wallet stays available when the feature flags
    // are off, so nobody is trapped; funding and completing never are.
    const runtime =
      input.action === 'cancel'
        ? (readPrimaryWalletSavingsRuntime() ??
          readPrimaryWalletSavingsRecoveryRuntime())
        : readPrimaryWalletSavingsRuntime();
    if (!runtime || runtime.merchantId !== input.merchantId)
      return refuse(
        'PIN checks are temporarily unavailable.',
        'SAVINGS_NOT_READY',
        503
      );
    const identity = await resolvePrimaryWalletIdentity({
      supabase: auth.supabase,
      user: auth.user,
      merchantId: runtime.merchantId,
      forOnboarding: false,
    });
    if (!identity)
      return refuse(
        'Please verify your email and complete your profile.',
        'PROFILE_VERIFICATION_REQUIRED',
        409
      );
    const supabase = auth.supabase;
    const result = await verifyGoalPin({
      rpc: (name, args) => supabase.rpc(name, args),
      userId: identity.userId,
      merchantId: identity.merchantId,
      pin: input.pin,
      binding: buildGoalPinBinding(input),
      now: () => Date.now(),
    });
    switch (result.status) {
      case 'verified':
        return NextResponse.json(
          { proof: result.proof, expiresAt: result.expiresAt },
          { headers: NO_STORE }
        );
      case 'incorrect':
        return refuse('That PIN is not right.', 'PIN_INCORRECT', 401, {
          attemptsRemaining: result.attemptsRemaining,
        });
      case 'locked':
        return refuse(
          'Too many wrong PINs. Please try again later.',
          'PIN_LOCKED',
          423,
          { lockedUntil: result.lockedUntil }
        );
      case 'not_set':
        return refuse('Please set your PIN first.', 'PIN_NOT_SET', 409);
      case 'reset_required':
        return refuse('Please reset your PIN.', 'PIN_RESET_REQUIRED', 409);
      case 'too_many_proofs':
        return refuse('Please wait a moment and try again.', 'PIN_BUSY', 429);
      default:
        return refuse(
          'PIN checks are temporarily unavailable.',
          'PIN_UNAVAILABLE',
          503
        );
    }
  } catch {
    return refuse(
      'PIN checks are temporarily unavailable.',
      'PIN_UNAVAILABLE',
      503
    );
  }
}
