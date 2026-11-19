import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  checkPrimaryWalletGoalCompleteStatus,
  issuePrimaryWalletGoalComplete,
  submitPrimaryWalletGoalComplete,
} from '@/lib/piggyvest/goal-complete-runtime';
import { isPiggyvestGoalCompleteDisabled } from '@/lib/piggyvest/goal-complete-switch';
import { isCompletableOwnGoal } from '@/lib/piggyvest/goal-pin-fund-eligibility';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readPrimaryWalletSavingsRecoveryRuntime } from '@/lib/piggyvest/primary-wallet-savings-runtime';
import { piggyvestGoalCompleteSchemas as schemas } from '@/schemas/piggyvest-goal-complete';

const NO_STORE = { 'Cache-Control': 'no-store' };

function respond(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
function refuse(error: string, code: string, status: number) {
  return respond({ error, code }, status);
}

/**
 * Complete a goal: the whole balance, interest included, moves to the main
 * wallet and a purchase request is saved for the owner, who fulfils it by
 * hand. There is no checkout, no wallet spend and no bank payout. The
 * recovery runtime carries the credentials and ignores the flags and the
 * master kill switch, like cancel: this only moves the customer's own money
 * from their goal wallet to their own main wallet, behind a PIN proof bound
 * to a server-issued operation id. The single exception is the complete-only
 * off switch (PIGGYVEST_GOAL_COMPLETE_DISABLED), which refuses NEW issue and
 * submit steps while status checks keep settling.
 */
type IdentityInput = Parameters<typeof resolvePrimaryWalletIdentity>[0];
type Caller = Pick<IdentityInput, 'supabase' | 'user'>;

async function guard(
  request: NextRequest
): Promise<{ caller: Caller } | { error: NextResponse }> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return { error: refuse('Please sign in again.', 'UNAUTHORIZED', 401) };
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid)
    return {
      error:
        csrf.response ??
        refuse('Please refresh and try again.', 'CSRF_FAILED', 403),
    };
  return { caller: { user: auth.user, supabase: auth.supabase } };
}

async function resolve(caller: Caller, merchantId: string) {
  const runtime = readPrimaryWalletSavingsRecoveryRuntime();
  if (runtime.merchantId !== merchantId)
    return {
      ok: false as const,
      error: refuse(
        'Goal completion is temporarily unavailable.',
        'SAVINGS_NOT_READY',
        503
      ),
    };
  const identity = await resolvePrimaryWalletIdentity({
    ...caller,
    merchantId: runtime.merchantId,
    forOnboarding: false,
  });
  if (!identity)
    return {
      ok: false as const,
      error: refuse(
        'Please verify your email and complete your profile.',
        'PROFILE_VERIFICATION_REQUIRED',
        409
      ),
    };
  return {
    ok: true as const,
    runtime,
    identity,
    scope: {
      merchantId: identity.merchantId,
      customerId: identity.customerId,
      userId: identity.userId,
      integrationId: runtime.configuration.integrationId,
      environment: runtime.configuration.environment,
      businessId: runtime.businessId,
    },
  };
}

const UNAVAILABLE = (): NextResponse =>
  refuse(
    'Could not confirm this completion. Please check its status before trying again.',
    'COMPLETE_UNAVAILABLE',
    503
  );

const NEEDS_REVIEW = (): NextResponse =>
  refuse(
    'This completion needs a quick review by our team before it can finish. Your savings are safe. Please do not try again.',
    'GOAL_NEEDS_REVIEW',
    409
  );

const NOT_ELIGIBLE = (): NextResponse =>
  refuse(
    'This goal can be completed once it reaches its target or its end date.',
    'COMPLETE_NOT_ELIGIBLE',
    409
  );

const BUSY = (): NextResponse =>
  refuse(
    'Another savings action is still processing. Please try again shortly.',
    'COMPLETE_BUSY',
    409
  );

const REJECTED = (): NextResponse =>
  refuse(
    'PiggyVest did not accept the transfer. Your savings are unchanged.',
    'COMPLETE_REJECTED',
    409
  );

// The only attempt states a status check may show a customer.
const PUBLIC_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'confirmed',
  'needs_review',
  'not_started',
]);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarded = await guard(request);
  if ('error' in guarded) return guarded.error;
  const body = schemas.httpRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!body.success)
    return refuse('Invalid completion request.', 'INVALID_INPUT', 400);
  const input = body.data;
  if (isPiggyvestGoalCompleteDisabled())
    return refuse(
      'Goal completion is temporarily unavailable.',
      'SAVINGS_UNAVAILABLE',
      503
    );
  try {
    const resolved = await resolve(guarded.caller, input.merchantId);
    if (!resolved.ok) return resolved.error;
    const { runtime, identity, scope } = resolved;
    if (input.step === 'issue') {
      const owned = await isCompletableOwnGoal({
        supabase: guarded.caller.supabase,
        merchantId: identity.merchantId,
        customerId: identity.customerId,
        goalId: input.goalId,
      });
      if (!owned)
        return refuse(
          'That savings goal was not found.',
          'GOAL_NOT_FOUND',
          404
        );
      const issued = await issuePrimaryWalletGoalComplete({
        configuration: runtime.configuration,
        scope,
        goalId: input.goalId,
      });
      if (!('operationId' in issued)) {
        if (issued.status === 'busy') return BUSY();
        if (issued.status === 'needs_review') return NEEDS_REVIEW();
        return NOT_ELIGIBLE();
      }
      // 'pending' means an attempt is already live: its id is for polling the
      // PATCH status check, not for a PIN (the PIN route only accepts ids in
      // the issued state). 'confirmed' is a goal that was already completed.
      return respond(
        { status: issued.status, operationId: issued.operationId },
        200
      );
    }
    // Submit needs no separate goal lookup: the database only reserves an
    // operation id it issued for this customer and goal, and a replay of a
    // confirmed complete must still answer confirmed.
    const result = await submitPrimaryWalletGoalComplete({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      scope,
      goalId: input.goalId,
      operationId: input.operationId,
      pinProof: input.pinProof,
    });
    switch (result.status) {
      case 'pin_refused':
        return refuse(
          result.reason === 'missing'
            ? 'Please confirm your PIN to continue.'
            : 'Please confirm your PIN again to continue.',
          result.reason === 'missing'
            ? 'PIN_PROOF_REQUIRED'
            : 'PIN_PROOF_REFUSED',
          result.reason === 'missing' ? 400 : 403
        );
      case 'confirmed':
        return respond(
          { status: 'confirmed', operationId: input.operationId },
          200
        );
      case 'pending':
        return respond(
          { status: 'pending', operationId: input.operationId },
          202
        );
      case 'released':
        return REJECTED();
      case 'empty':
        return refuse(
          'This goal has no balance to move.',
          'NOTHING_TO_MOVE',
          409
        );
      case 'too_large':
        return refuse(
          'This goal balance is above the automatic limit. Please contact support.',
          'AMOUNT_TOO_LARGE',
          409
        );
      case 'expired':
        return refuse(
          'This completion expired. Please start again.',
          'COMPLETE_EXPIRED',
          409
        );
      case 'needs_review':
        return NEEDS_REVIEW();
      case 'busy':
        return BUSY();
      case 'not_eligible':
        return NOT_ELIGIBLE();
      case 'unavailable':
        return refuse(
          'Could not confirm the wallet details. Please try again later.',
          'WALLET_UNAVAILABLE',
          503
        );
      default:
        return refuse(
          'This completion could not be matched. Please refresh your savings.',
          'COMPLETE_CONFLICT',
          409
        );
    }
  } catch {
    return UNAVAILABLE();
  }
}

/** Status check: the only thing a retry does. It never sends money. */
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const guarded = await guard(request);
  if ('error' in guarded) return guarded.error;
  const body = schemas.statusRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!body.success)
    return refuse('Invalid completion request.', 'INVALID_INPUT', 400);
  try {
    const resolved = await resolve(guarded.caller, body.data.merchantId);
    if (!resolved.ok) return resolved.error;
    const { runtime, scope } = resolved;
    const result = await checkPrimaryWalletGoalCompleteStatus({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      scope,
      operationId: body.data.operationId,
    });
    if (result.status === 'not_found')
      return refuse('Completion not found.', 'COMPLETE_NOT_FOUND', 404);
    // Internal attempt states never leave the route: a released attempt is the
    // same rejection POST reports, and only the public vocabulary is returned.
    if (result.status === 'released') return REJECTED();
    if (!PUBLIC_STATUSES.has(result.status)) return UNAVAILABLE();
    return respond(
      { status: result.status, operationId: body.data.operationId },
      200
    );
  } catch {
    return UNAVAILABLE();
  }
}
