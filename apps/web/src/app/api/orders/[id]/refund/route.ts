import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { orderRefundSchema } from '@/schemas/order-refund';

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
        p_note: body.note ?? null,
      });
  }
  const { data, error } = await auth.supabase.rpc('manage_order_refund', args);
  if (error) {
    const status =
      error.code === '42501'
        ? 403
        : error.code === 'P0002'
          ? 404
          : error.code === 'P0001'
            ? 409
            : error.code === '22023'
              ? 400
              : 500;
    return NextResponse.json(
      {
        error:
          status === 500
            ? 'Unable to manage refund'
            : error.message.replaceAll('_', ' '),
        code: error.code,
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
