import 'server-only';
import { NextResponse } from 'next/server';
import { goalCancelAmountFields } from '@/lib/piggyvest/goal-cancel-amount-fields';
import type { submitPrimaryWalletGoalCancel } from '@/lib/piggyvest/goal-cancel-runtime';

// The goal-cancel route's answers: every customer-facing reply shape and the
// mapping of a submit outcome to its HTTP answer (one place, so the copy and
// codes the app relies on stay consistent).
const NO_STORE = { 'Cache-Control': 'no-store' };

export function respond(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
export function refuse(error: string, code: string, status: number) {
  return respond({ error, code }, status);
}

export const UNAVAILABLE = (): NextResponse =>
  refuse(
    'Could not confirm this cancellation. Please check its status before trying again.',
    'CANCEL_UNAVAILABLE',
    503
  );

export const NEEDS_REVIEW = (): NextResponse =>
  refuse(
    'This cancellation needs a quick review by our team before it can finish. Your savings are safe. Please do not try again.',
    'GOAL_NEEDS_REVIEW',
    409
  );

// The only attempt states a status check may show a customer.
export const PUBLIC_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'confirmed',
  'needs_review',
  'not_started',
]);

// One truthful answer for every released attempt: a provider rejection and a
// cancel refused before anything moved (for example no interest wallet
// configured) both leave the savings untouched. It does not invite a retry: a
// held attempt can not be retried until our team clears it (the next start
// then says it is under review).
export const REJECTED = (): NextResponse =>
  refuse(
    'This cancellation did not go through. Nothing was moved and your savings are unchanged.',
    'CANCEL_REJECTED',
    409
  );

type SubmitResult = Awaited<ReturnType<typeof submitPrimaryWalletGoalCancel>>;

/** The HTTP answer for a submit outcome (never moves money itself). */
export function goalCancelSubmitResponse(
  result: SubmitResult,
  operationId: string
): NextResponse {
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
          operationId: operationId,
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
}
