import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { goalCancelAmountFields } from '@/lib/piggyvest/goal-cancel-amount-fields';
import { goalCancelForfeitTransfersAllowed } from '@/lib/piggyvest/goal-cancel-forfeit-cron';
import {
  checkPrimaryWalletGoalCancelStatus,
  issuePrimaryWalletGoalCancel,
  submitPrimaryWalletGoalCancel,
} from '@/lib/piggyvest/goal-cancel-runtime';
import { isPiggyvestGoalCancelDisabled } from '@/lib/piggyvest/goal-cancel-switch';
import { isCancellableOwnGoal } from '@/lib/piggyvest/goal-pin-fund-eligibility';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readPrimaryWalletSavingsRecoveryRuntime } from '@/lib/piggyvest/primary-wallet-savings-runtime';
import { piggyvestGoalCancelSchemas as schemas } from '@/schemas/piggyvest-goal-cancel';

const NO_STORE = { 'Cache-Control': 'no-store' };

function respond(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
function refuse(error: string, code: string, status: number) {
  return respond({ error, code }, status);
}

/**
 * Cancel a goal early: the saved principal goes back to the main wallet and
 * the goal's interest is forfeited to Ogabassey (owner decision 2026-11-12);
 * answers carry principalKobo / forfeitedInterestKobo from the server once the
 * attempt is dispatched. The recovery runtime carries the credentials and
 * ignores the flags and the master kill switch, so a customer is never trapped
 * in a goal, behind a PIN proof bound to a server-issued operation id. The
 * single exception is the cancel-only off switch (PIGGYVEST_GOAL_CANCEL_DISABLED),
 * which refuses NEW issue/submit steps while status checks keep settling.
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
        'Goal cancellation is temporarily unavailable.',
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
    'Could not confirm this cancellation. Please check its status before trying again.',
    'CANCEL_UNAVAILABLE',
    503
  );

const NEEDS_REVIEW = (): NextResponse =>
  refuse(
    'This cancellation needs a quick review by our team before it can finish. Your savings are safe. Please do not try again.',
    'GOAL_NEEDS_REVIEW',
    409
  );

// The only attempt states a status check may show a customer.
const PUBLIC_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'confirmed',
  'needs_review',
  'not_started',
]);

// One truthful answer for every released attempt: a provider rejection and a
// cancel refused before anything moved (for example no interest wallet
// configured) both leave the savings untouched, and the customer can retry.
const REJECTED = (): NextResponse =>
  refuse(
    'This cancellation did not go through. Nothing was moved and your savings are unchanged. You can try again later.',
    'CANCEL_REJECTED',
    409
  );

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarded = await guard(request);
  if ('error' in guarded) return guarded.error;
  const body = schemas.httpRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!body.success)
    return refuse('Invalid cancellation request.', 'INVALID_INPUT', 400);
  const input = body.data;
  if (isPiggyvestGoalCancelDisabled())
    return refuse(
      'Goal cancellation is temporarily unavailable.',
      'SAVINGS_UNAVAILABLE',
      503
    );
  // An app that never showed the interest forfeit (older builds say the
  // whole balance, interest included, comes back) can not move money: it is
  // asked to update. Nothing is reserved; the issued attempt simply expires.
  if (input.step === 'submit' && input.interestForfeitAcknowledged !== true)
    return refuse(
      'Please update the app to cancel this goal.',
      'APP_UPDATE_REQUIRED',
      409
    );
  try {
    const resolved = await resolve(guarded.caller, input.merchantId);
    if (!resolved.ok) return resolved.error;
    const { runtime, identity, scope } = resolved;
    if (input.step === 'issue') {
      const owned = await isCancellableOwnGoal({
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
      const issued = await issuePrimaryWalletGoalCancel({
        configuration: runtime.configuration,
        scope,
        goalId: input.goalId,
      });
      if (issued.status === 'busy')
        return refuse(
          'A contribution is still processing. Please try again shortly.',
          'CANCEL_BUSY',
          409
        );
      if (issued.status === 'needs_review') return NEEDS_REVIEW();
      if (issued.status === 'not_set_up')
        return refuse(
          "This plan is still being set up, so there's nothing to cancel yet.",
          'GOAL_NOT_SET_UP',
          409
        );
      // 'pending' means an attempt is already live: its id is for polling the
      // PATCH status check, not for a PIN (the PIN route only accepts ids in
      // the issued state).
      return respond(
        { status: issued.status, operationId: issued.operationId },
        200
      );
    }
    // Submit needs no separate goal lookup: the database only reserves an
    // operation id it issued for this customer and goal, and a replay of a
    // confirmed cancel must still answer confirmed after the goal is gone.
    const result = await submitPrimaryWalletGoalCancel({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      scope,
      goalId: input.goalId,
      operationId: input.operationId,
      pinProof: input.pinProof,
      allowForfeitTransfers: goalCancelForfeitTransfersAllowed(),
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
      case 'pending':
        return respond(
          {
            status: result.status,
            operationId: input.operationId,
            ...goalCancelAmountFields(result),
          },
          result.status === 'confirmed' ? 200 : 202
        );
      case 'released':
        return REJECTED();
      case 'empty':
        return refuse(
          'This goal has no balance to refund.',
          'NOTHING_TO_REFUND',
          409
        );
      case 'too_large':
        return refuse(
          'This goal balance is above the automatic refund limit. Please contact support.',
          'AMOUNT_TOO_LARGE',
          409
        );
      case 'expired':
        return refuse(
          'This cancellation expired. Please start again.',
          'CANCEL_EXPIRED',
          409
        );
      case 'needs_review':
        return NEEDS_REVIEW();
      case 'busy':
        return refuse(
          'A contribution is still processing. Please try again shortly.',
          'CANCEL_BUSY',
          409
        );
      case 'unavailable':
        return refuse(
          'Could not confirm the wallet details. Please try again later.',
          'WALLET_UNAVAILABLE',
          503
        );
      default:
        return refuse(
          'This cancellation could not be matched. Please refresh your savings.',
          'CANCEL_CONFLICT',
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
    return refuse('Invalid cancellation request.', 'INVALID_INPUT', 400);
  try {
    const resolved = await resolve(guarded.caller, body.data.merchantId);
    if (!resolved.ok) return resolved.error;
    const { runtime, scope } = resolved;
    const result = await checkPrimaryWalletGoalCancelStatus({
      configuration: runtime.configuration,
      reconciliationConfiguration: runtime.reconciliationConfiguration,
      providerToken: runtime.providerToken,
      scope,
      operationId: body.data.operationId,
      allowForfeitTransfers: goalCancelForfeitTransfersAllowed(),
    });
    if (result.status === 'not_found')
      return refuse('Cancellation not found.', 'CANCEL_NOT_FOUND', 404);
    // Internal attempt states never leave the route: a released attempt is the
    // same rejection POST reports, and only the public vocabulary is returned.
    if (result.status === 'released') return REJECTED();
    if (!PUBLIC_STATUSES.has(result.status)) return UNAVAILABLE();
    return respond(
      {
        status: result.status,
        operationId: body.data.operationId,
        ...goalCancelAmountFields(result),
      },
      200
    );
  } catch {
    return UNAVAILABLE();
  }
}
