import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { orderRefundSchema } from '@/schemas/order-refund';

// Fixed user-facing messages for known refund identifiers. Raw database
// exception text must never reach the client (CWE-209): unknown
// identifiers fall back to the generic message.
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
};

async function handle(
  request: NextRequest,
  params: Promise<{ id: string }>,
  mutate: boolean
) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (mutate) {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid)
      return (
        csrf.response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  let args: Record<string, unknown> = { p_order_id: id, p_action: 'status' };
  if (mutate) {
    const parsed = orderRefundSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Invalid refund request' },
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
      });
  }
  const { data, error } = await auth.supabase.rpc('manage_order_refund', args);
  if (error) {
    const status =
      error.code === '42501'
        ? 403
        : error.code === '28000'
          ? 401
          : error.code === 'P0002'
            ? 404
            : error.code === 'P0001'
              ? 409
              : error.code === '22023'
                ? 400
                : 500;
    // Callers only branch on the application-level code: raw SQLSTATEs
    // stay server-side so error classes are not fingerprinted. The RPC
    // converts its own reference race to manual_reference_conflict, so
    // any residual 23505 here is genuinely unexpected (500), never a
    // blanket-mapped conflict that could mask an unrelated violation.
    const code =
      KNOWN_REFUND_ERRORS[error.message] === undefined
        ? 'internal_error'
        : error.message;
    return NextResponse.json(
      {
        error: KNOWN_REFUND_ERRORS[error.message] ?? 'Unable to manage refund',
        code,
      },
      { status }
    );
  }
  return NextResponse.json(data);
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
