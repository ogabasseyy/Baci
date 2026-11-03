import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  checkPrimaryWalletGoalCancelStatus,
  issuePrimaryWalletGoalCancel,
  submitPrimaryWalletGoalCancel,
} from '@/lib/piggyvest/goal-cancel-runtime';
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
 * Cancel a goal and refund the whole balance, interest included, to the main
 * wallet. This route deliberately reads neither the PiggyVest feature flags,
 * the master kill switch nor the customer savings setting: it uses the
 * recovery runtime, so a customer is never trapped in a goal. It only ever
 * moves money from the customer's own goal wallet to the customer's own main
 * wallet, behind a PIN proof bound to a server-issued operation id.
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guarded = await guard(request);
  if ('error' in guarded) return guarded.error;
  const body = schemas.httpRequest.safeParse(
    await request.json().catch(() => null)
  );
  if (!body.success)
    return refuse('Invalid cancellation request.', 'INVALID_INPUT', 400);
  const input = body.data;
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
        return refuse(
          'PiggyVest did not accept the refund. Your savings are unchanged.',
          'CANCEL_REJECTED',
          409
        );
      case 'empty':
        return refuse(
          'This goal has no balance to refund.',
          'NOTHING_TO_REFUND',
          409
        );
      case 'expired':
        return refuse(
          'This cancellation expired. Please start again.',
          'CANCEL_EXPIRED',
          409
        );
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
    });
    if (result.status === 'not_found')
      return refuse('Cancellation not found.', 'CANCEL_NOT_FOUND', 404);
    return respond(
      { status: result.status, operationId: body.data.operationId },
      200
    );
  } catch {
    return UNAVAILABLE();
  }
}
