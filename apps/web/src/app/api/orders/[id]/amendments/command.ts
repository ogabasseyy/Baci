import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  amendmentActionParams,
  amendmentActionSchema,
  amendmentConfirmSchema,
  amendmentOrderParams,
  amendmentPreviewSchema,
} from '@/schemas/order-amendment';

type Context = { params: Promise<{ id: string }> };
type Command = 'preview' | 'confirm' | 'read' | 'action';

const conflicts: ReadonlyMap<string, string> = new Map([
  ['bank_evidence_required', 'Select a verified bank statement entry.'],
  [
    'bank_evidence_conflict',
    'This bank entry has already been allocated or does not match.',
  ],
  [
    'refund_evidence_required',
    'Verify the refund outcome before making this change.',
  ],
  ['refund_claim_open', 'An existing disbursement claim must be resolved.'],
  [
    'merchant_adjustment_review',
    'Finance must reconcile the merchant adjustment.',
  ],
  ['already_amended', 'This order already has an amendment.'],
  ['amendment_ineligible', 'This order or replacement is not eligible.'],
  ['amendment_payment_open', 'Resolve the existing payment attempt first.'],
  [
    'amendment_fulfillment_open',
    'The order already has a fulfillment commitment.',
  ],
  ['amendment_hold', 'Resolve the order amendment first.'],
  [
    'idempotency_conflict',
    'This request key was already used for a different change.',
  ],
  ['preview_stale', 'The order changed. Preview the replacement again.'],
  ['scenario_disabled', 'This amendment scenario is currently disabled.'],
  ['replacement_unavailable', 'The replacement stock is no longer available.'],
]);

export async function runAmendmentCommand(
  request: NextRequest,
  { params }: Context,
  command: Command
) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const routeParams = await params;
  const order = amendmentOrderParams.safeParse(routeParams);
  if (!order.success) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const args = { p_order_id: order.data.id };
  if (command === 'read') {
    const search = new URL(request.url).searchParams;
    if (search.has('lineId') || search.has('search')) {
      const selection = z
        .object({ lineId: z.uuid(), search: z.string().trim().min(2).max(80) })
        .safeParse({
          lineId: search.get('lineId'),
          search: search.get('search'),
        });
      if (!selection.success)
        return NextResponse.json(
          { error: 'Invalid replacement search' },
          { status: 400 }
        );
      return amendmentResponse(
        await auth.supabase.rpc('search_paid_order_amendment_replacements', {
          ...args,
          p_line_id: selection.data.lineId,
          p_search: selection.data.search,
        })
      );
    }
    return amendmentResponse(
      await auth.supabase.rpc('read_paid_order_amendment_workspace', args)
    );
  }

  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 }
    );
  }

  if (command === 'action') {
    const ids = amendmentActionParams.safeParse(routeParams);
    const action = amendmentActionSchema.safeParse(body);
    if (!ids.success || !action.success) {
      return NextResponse.json(
        { error: 'Invalid amendment action' },
        { status: 400 }
      );
    }
    return amendmentResponse(
      await auth.supabase.rpc('run_paid_order_amendment_action', {
        ...args,
        p_amendment_id: ids.data.amendmentId,
        p_payload: action.data,
      })
    );
  }

  const schema =
    command === 'preview' ? amendmentPreviewSchema : amendmentConfirmSchema;
  const payload = schema.safeParse(body);
  if (!payload.success) {
    return NextResponse.json(
      { error: 'Invalid amendment request' },
      { status: 400 }
    );
  }

  const result = await auth.supabase.rpc(
    command === 'preview'
      ? 'preview_paid_order_amendment'
      : 'confirm_paid_order_amendment',
    { ...args, p_payload: payload.data }
  );
  return amendmentResponse(result);
}

function amendmentResponse({
  data,
  error,
}: {
  data: unknown;
  error: { code: string; message: string } | null;
}) {
  if (!error) return NextResponse.json(data);
  if (error.code === '42501') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (error.code === 'P0002') {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  if (error.code === '22023' || error.code === '22P02') {
    return NextResponse.json(
      { error: 'Invalid amendment request' },
      { status: 400 }
    );
  }

  if (error.code === '55P03') {
    return NextResponse.json(
      {
        code: 'amendment_busy',
        error: 'This order is busy. Please try again shortly.',
      },
      { status: 409 }
    );
  }

  const conflict =
    error.code === 'P0001' ? conflicts.get(error.message) : undefined;
  return conflict
    ? NextResponse.json(
        { code: error.message, error: conflict },
        { status: 409 }
      )
    : NextResponse.json(
        { error: 'Unable to process order amendment' },
        { status: 500 }
      );
}
