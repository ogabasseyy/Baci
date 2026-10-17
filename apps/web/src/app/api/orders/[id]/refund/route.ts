import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { maskRefundWorkerText } from '@/lib/orders/mask-refund-worker-text';
import { orderRefundSchema } from '@/schemas/order-refund';

// Fixed user-facing messages for known refund identifiers. Raw database
// exception text must never reach the client (CWE-209): unknown
// identifiers fall back to the generic message. Success payloads
// arrive pre-masked from the RPC (direct REST callers bypass this
// route), so the summary error passes through untouched below.
const KNOWN_REFUND_ERRORS: Record<string, string> = {
  not_authenticated: 'Authentication required',
  refund_forbidden: 'You do not have permission to manage this refund',
  order_not_found: 'Order not found',
  cancelled_paid_order_required: 'Refunds require a cancelled, paid order',
  refund_processing_or_requires_review:
    'Refund is processing or requires review',
  invalid_manual_refund: 'Invalid manual refund request',
  already_refunded: 'This order has already been fully refunded',
  failed_refund_required: 'Only a failed refund can be retried',
  refund_exceeds_remaining: 'Refund amount exceeds the remaining balance',
  manual_reference_conflict:
    'This reference was already used for a different refund',
  unallocated_refund_requires_review: 'Refund requires review before recording',
  manual_completion_required:
    'Finish the remaining balance as a manual refund before retrying',
  payment_currency_requires_review: 'Refund requires review before recording',
  payment_ledger_requires_review: 'Refund requires review before recording',
  invalid_refund_action: 'Invalid refund request',
  refund_confirmation_required:
    'Confirm that the money already moved before recording',
  retry_too_soon: 'Please wait a minute before retrying',
};
const KNOWN_REFUND_ERROR_KEYS = new Set(Object.keys(KNOWN_REFUND_ERRORS));

// HTTP status per known application error. Genuine state conflicts
// (busy, already done, reference race, review-blocked) stay 409;
// malformed requests are 400, failed state preconditions are 422,
// and identity errors mirror their transport status. Callers branch
// on the code field; the status keeps caches and telemetry honest.
const KNOWN_REFUND_STATUS: Record<string, number> = {
  not_authenticated: 401,
  refund_forbidden: 403,
  order_not_found: 404,
  cancelled_paid_order_required: 422,
  refund_processing_or_requires_review: 409,
  invalid_manual_refund: 400,
  already_refunded: 409,
  failed_refund_required: 422,
  refund_exceeds_remaining: 422,
  manual_reference_conflict: 409,
  unallocated_refund_requires_review: 409,
  manual_completion_required: 409,
  payment_currency_requires_review: 409,
  payment_ledger_requires_review: 409,
  invalid_refund_action: 400,
  refund_confirmation_required: 400,
  retry_too_soon: 429,
};

async function handle(
  request: NextRequest,
  params: Promise<{ id: string }>,
  mutate: boolean
) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: 'Unauthorized', code: 'not_authenticated' },
      { status: 401 }
    );
  }
  if (mutate) {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid)
      return (
        csrf.response ??
        NextResponse.json(
          { error: 'CSRF validation failed', code: 'csrf_validation_failed' },
          { status: 403 }
        )
      );
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json(
      { error: 'Invalid order ID', code: 'invalid_order_id' },
      { status: 400 }
    );
  let args: Record<string, unknown> = { p_order_id: id, p_action: 'status' };
  if (mutate) {
    const parsed = orderRefundSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Invalid refund request', code: 'invalid_refund_request' },
        { status: 400 }
      );
    const body = parsed.data;
    args = { p_order_id: id, p_action: body.action };
    if (body.action === 'manual')
      Object.assign(args, {
        p_amount: body.amount,
        p_refunded_at: body.refundedAt,
        p_method: body.method,
        p_reference: body.reference,
        p_note: body.note ? body.note : null,
        p_confirmed: body.confirmed,
        p_payment_transaction_id: body.paymentTransactionId ?? null,
      });
  }
  const { data, error } = await auth.supabase.rpc('manage_order_refund', args);
  if (error) {
    // Callers only branch on the application-level code: raw SQLSTATEs
    // stay server-side so error classes are not fingerprinted. The RPC
    // converts its own reference race to manual_reference_conflict, so
    // any residual 23505 here is genuinely unexpected (500), never a
    // blanket-mapped conflict that could mask an unrelated violation.
    // Match on whole identifier tokens: drivers can wrap the RAISE
    // text with surrounding context, but a bare substring would also
    // match an unrelated word that merely contains a known token
    // (e.g. a constraint name). Token membership keeps wrapped known
    // failures coded while unknown text falls back to internal_error.
    // Lowercase first: without it, uppercase letters act as
    // delimiters and a wrapper that uppercases the RAISE text would
    // miss every match. Scan in message order: a wrapped message
    // naming two known tokens maps to the first one the database
    // raised, not whichever key the dictionary inserted first.
    // Match only application-raised classes: a
    // constraint or engine error that happens to echo a
    // merchant-controlled value containing a known token (e.g. a
    // crafted 23505 message) must not be mistaken for the
    // application state it names.
    const messageTokens = String(error.message ?? '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/);
    const matchedError = ['P0001', '22023', '42501', '28000', 'P0002'].includes(
      error.code ?? ''
    )
      ? messageTokens.find((token) => KNOWN_REFUND_ERROR_KEYS.has(token))
      : undefined;
    const code = matchedError ?? 'internal_error';
    // A matched application error carries its own semantic status;
    // unmatched errors keep the SQLSTATE-derived transport status.
    // An unmatched P0001 is a server bug, not a conflict: every
    // legitimate raise from this RPC is a known token, so anything
    // else in that class is an unlisted raise (500), never a client
    // state the caller could resolve with a retry.
    const status =
      (matchedError ? KNOWN_REFUND_STATUS[matchedError] : undefined) ??
      (error.code === '42501'
        ? 403
        : error.code === '28000'
          ? 401
          : error.code === 'P0002'
            ? 404
            : error.code === '22023'
              ? 400
              : 500);
    return NextResponse.json(
      {
        error:
          (matchedError ? KNOWN_REFUND_ERRORS[matchedError] : undefined) ??
          'Unable to manage refund',
        code,
      },
      { status }
    );
  }
  return NextResponse.json(
    data && typeof data === 'object'
      ? maskRefundWorkerText(data as Record<string, unknown>)
      : data
  );
}

export function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(request, params, false);
}
export function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(request, params, true);
}
