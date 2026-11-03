import { type NextRequest, NextResponse } from 'next/server';
import { getPrimaryCustomerSavingsFeatureSettings } from '@/app/api/storefront/customer/savings/customer-savings-feature-settings';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { buildGoalPinBinding } from '@/lib/piggyvest/goal-pin-binding';
import { isActiveOwnGoal } from '@/lib/piggyvest/goal-pin-fund-eligibility';
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
    // A proof is only issued for an action that could proceed: the goal must
    // be an active goal of this customer, and funding or completing also
    // needs the customer savings feature on. Cancel stays available without
    // the feature so nobody is trapped.
    if (input.action !== 'cancel') {
      const features = await getPrimaryCustomerSavingsFeatureSettings({
        supabase,
        merchantId: identity.merchantId,
        customerId: identity.customerId,
      });
      if (!features.savingsEnabled)
        return refuse(
          'Savings is not enabled.',
          'CUSTOMER_SAVINGS_DISABLED',
          403
        );
    }
    const owned = await isActiveOwnGoal({
      supabase,
      merchantId: identity.merchantId,
      customerId: identity.customerId,
      goalId: input.goalId,
    });
    if (!owned)
      return refuse('That savings goal was not found.', 'GOAL_NOT_FOUND', 404);
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
