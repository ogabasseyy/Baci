import { type NextRequest, NextResponse } from 'next/server';
import { getPrimaryCustomerSavingsFeatureSettings } from '@/app/api/storefront/customer/savings/customer-savings-feature-settings';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { isPrimaryWalletGoalCancelIssued } from '@/lib/piggyvest/goal-cancel-runtime';
import { isPiggyvestGoalCancelDisabled } from '@/lib/piggyvest/goal-cancel-switch';
import { isPrimaryWalletGoalCompleteIssued } from '@/lib/piggyvest/goal-complete-runtime';
import { isPiggyvestGoalCompleteDisabled } from '@/lib/piggyvest/goal-complete-switch';
import { buildGoalPinBinding } from '@/lib/piggyvest/goal-pin-binding';
import {
  isActiveOwnGoal,
  isCancellableOwnGoal,
  isCompletableOwnGoal,
} from '@/lib/piggyvest/goal-pin-fund-eligibility';
import { verifyGoalPin } from '@/lib/piggyvest/goal-pin-verify';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import {
  readPrimaryWalletSavingsRecoveryRuntime,
  readPrimaryWalletSavingsRuntime,
} from '@/lib/piggyvest/primary-wallet-savings-runtime';
import { chargeWalletPinCustomerLimit } from '@/lib/wallet-pin/wallet-pin-customer-limit';
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
  // The cancel-only emergency switch refuses NEW cancels, and a PIN check is
  // the first step of one: no attempt is counted and no proof is minted.
  if (input.action === 'cancel' && isPiggyvestGoalCancelDisabled())
    return refuse(
      'Goal cancellation is temporarily unavailable.',
      'SAVINGS_UNAVAILABLE',
      503
    );
  // Likewise the complete-only switch refuses NEW completes before any PIN
  // attempt is counted. It never touches funding or cancel PIN checks.
  if (input.action === 'complete' && isPiggyvestGoalCompleteDisabled())
    return refuse(
      'Goal completion is temporarily unavailable.',
      'SAVINGS_UNAVAILABLE',
      503
    );
  try {
    // Cancel and complete return the customer's own money to their own main
    // wallet, so they stay available with the PiggyVest flags and the kill
    // switch off: their PIN checks use the recovery runtime, which reads
    // neither. Funding still needs the enabled runtime.
    const runtime =
      input.action === 'cancel' || input.action === 'complete'
        ? readPrimaryWalletSavingsRecoveryRuntime()
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
    // A funding proof is only issued for an active goal of this customer
    // while the customer savings feature is on. A cancel or complete proof
    // does not depend on the feature setting (nobody is trapped in a goal);
    // cancel is issued for an active or paused goal of this customer and
    // complete for an active, paused or completed one (whether the goal
    // reached its target or maturity is decided by the database).
    if (input.action === 'fund') {
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
    const ownership = {
      supabase,
      merchantId: identity.merchantId,
      customerId: identity.customerId,
      goalId: input.goalId,
    };
    const owned =
      input.action === 'cancel'
        ? await isCancellableOwnGoal(ownership)
        : input.action === 'complete'
          ? await isCompletableOwnGoal(ownership)
          : await isActiveOwnGoal(ownership);
    if (!owned)
      return refuse('That savings goal was not found.', 'GOAL_NOT_FOUND', 404);
    // A cancel proof is only minted for an operation id this database issued
    // for this customer and goal and that has not expired, so an invented or
    // foreign id can never hold one of the customer's live proof slots.
    if (input.action === 'cancel') {
      const issued = await isPrimaryWalletGoalCancelIssued({
        configuration: runtime.configuration,
        scope: {
          merchantId: identity.merchantId,
          customerId: identity.customerId,
          userId: identity.userId,
          integrationId: runtime.configuration.integrationId,
          environment: runtime.configuration.environment,
          businessId: runtime.businessId,
        },
        goalId: input.goalId,
        operationId: input.operationId,
      });
      if (!issued)
        return refuse(
          'This cancellation is no longer valid. Please start again.',
          'CANCEL_OPERATION_INVALID',
          409
        );
    }
    // The same for a complete proof: only for a live operation id this
    // database issued for this customer and goal.
    if (input.action === 'complete') {
      const issued = await isPrimaryWalletGoalCompleteIssued({
        configuration: runtime.configuration,
        scope: {
          merchantId: identity.merchantId,
          customerId: identity.customerId,
          userId: identity.userId,
          integrationId: runtime.configuration.integrationId,
          environment: runtime.configuration.environment,
          businessId: runtime.businessId,
        },
        goalId: input.goalId,
        operationId: input.operationId,
      });
      if (!issued)
        return refuse(
          'This completion is no longer valid. Please start again.',
          'COMPLETE_OPERATION_INVALID',
          409
        );
    }
    // Charged only now that the request will actually examine a PIN, so a
    // mistyped goal id or an eligibility refusal never burns the budget.
    const limited = await chargeWalletPinCustomerLimit(
      'goal-verify',
      identity.merchantId,
      identity.userId
    );
    if (limited) return limited;
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
