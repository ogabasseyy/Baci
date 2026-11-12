import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readPrimaryWalletRuntime } from '@/lib/piggyvest/primary-wallet-runtime';
import {
  chargeWalletPinCustomerLimit,
  type WalletPinCustomerBudget,
} from './wallet-pin-customer-limit';
import {
  readWalletPinStatus,
  type WalletPinOutcome,
} from './wallet-pin-operations';

const NO_STORE = { 'Cache-Control': 'no-store' };

type WalletPinContext = {
  readonly rpc: (
    name:
      | 'get_wallet_pin_state'
      | 'has_recent_wallet_pin_sign_in'
      | 'set_wallet_pin'
      | 'change_wallet_pin'
      | 'reset_wallet_pin',
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  readonly userId: string;
  readonly merchantId: string;
  readonly now: () => number;
};

function refuse(
  error: string,
  code: string,
  status: number,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return NextResponse.json(
    { error, code, ...extra },
    { status, headers: { ...NO_STORE, ...headers } }
  );
}

const unavailable = () =>
  refuse('PIN setup is temporarily unavailable.', 'PIN_UNAVAILABLE', 503);

// Stable public codes for every database answer. The PIN never appears in a
// message, code or field.
export function walletPinOutcomeResponse(outcome: WalletPinOutcome) {
  switch (outcome.status) {
    case 'ok':
      return NextResponse.json({ ok: true }, { headers: NO_STORE });
    case 'incorrect':
      return refuse('That PIN is not right.', 'PIN_INCORRECT', 401, {
        attemptsRemaining: outcome.attemptsRemaining,
      });
    case 'locked':
      return refuse(
        'Too many wrong PINs. Please try again later.',
        'PIN_LOCKED',
        423,
        { lockedUntil: outcome.lockedUntil }
      );
    case 'not_set':
      return refuse('Please set your PIN first.', 'PIN_NOT_SET', 409);
    case 'already_set':
      return refuse('A PIN is already set.', 'PIN_ALREADY_SET', 409);
    case 'reset_required':
      return refuse('Please reset your PIN.', 'PIN_RESET_REQUIRED', 409);
    case 'reauthentication_required':
      return refuse(
        'Please sign in again to continue.',
        'REAUTHENTICATION_REQUIRED',
        403
      );
    default:
      return unavailable();
  }
}

type Prepared =
  | { response: NextResponse }
  | { context: WalletPinContext | null };

// Auth first, then CSRF. The per-IP limit is owned by the API proxy stage (the
// /api/storefront/customer/wallet-pin buckets in rate-limit-routes.ts); the
// per-customer limit is charged once per mutation in handleWalletPinMutation,
// after authentication and a valid body. The merchant comes from the
// server's primary-wallet configuration and the customer from the signed-in
// account, never from the request.
async function prepare(request: NextRequest): Promise<Prepared> {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return { response: refuse('Please sign in again.', 'UNAUTHORIZED', 401) };
  const csrf = await checkCsrfProtection(request);
  // The shared check's own response has no stable code, so it is replaced.
  if (!csrf.valid)
    return {
      response: refuse('Please refresh and try again.', 'CSRF_FAILED', 403),
    };
  const runtime = readPrimaryWalletRuntime();
  if (!runtime) return { context: null };
  const identity = await resolvePrimaryWalletIdentity({
    supabase: auth.supabase,
    user: auth.user,
    merchantId: runtime.onboarding.merchantId,
    forOnboarding: false,
  });
  if (!identity)
    return {
      response: refuse(
        'Please verify your email and complete your profile.',
        'PROFILE_VERIFICATION_REQUIRED',
        409
      ),
    };
  const supabase = auth.supabase;
  return {
    context: {
      rpc: (name, args) => supabase.rpc(name, args),
      userId: identity.userId,
      merchantId: identity.merchantId,
      now: () => Date.now(),
    },
  };
}

export async function handleWalletPinStatus(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const prepared = await prepare(request);
    if ('response' in prepared) return prepared.response;
    if (!prepared.context)
      return NextResponse.json(
        {
          primary: false,
          hasPin: false,
          resetRequired: false,
          available: false,
          signInConfirmationRequired: false,
        },
        { headers: NO_STORE }
      );
    const status = await readWalletPinStatus({
      rpc: prepared.context.rpc,
      merchantId: prepared.context.merchantId,
    });
    return NextResponse.json(
      { primary: true, ...status },
      { headers: NO_STORE }
    );
  } catch {
    return unavailable();
  }
}

export async function handleWalletPinMutation<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
  run: (context: WalletPinContext, input: T) => Promise<WalletPinOutcome>,
  budget: WalletPinCustomerBudget = 'mutation'
): Promise<NextResponse> {
  try {
    const prepared = await prepare(request);
    if ('response' in prepared) return prepared.response;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return refuse('Please enter a valid PIN.', 'INVALID_INPUT', 400);
    if (!prepared.context) return unavailable();
    const limited = await chargeWalletPinCustomerLimit(
      budget,
      prepared.context.merchantId,
      prepared.context.userId
    );
    if (limited) return limited;
    return walletPinOutcomeResponse(await run(prepared.context, parsed.data));
  } catch {
    return unavailable();
  }
}
