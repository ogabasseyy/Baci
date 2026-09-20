import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { sendOrderCancellationEmail } from '@/lib/order-cancellation-email';
import { checkRateLimit } from '@/lib/rate-limiter';
import { storefrontOrderCancellationSchema } from '@/schemas/storefront-order-cancellation';

const orderIdSchema = z.uuid();
const RATE_LIMIT_WINDOW_MINUTES = 1;
const RETRY_AFTER_SECONDS = String(RATE_LIMIT_WINDOW_MINUTES * 60);

/**
 * POST /api/storefront/account/orders/[id]/cancel
 *
 * Lets an authenticated storefront customer cancel their own order while it is
 * still unpaid and not yet shipped. Serves both web (cookie) and mobile (Bearer)
 * via authenticateApiRequest. The state transition + restock + instrument
 * voiding happen atomically in the cancel_order_as_customer RPC (or the
 * REDVAULT-scoped cancel_uba_redvault_order_as_customer RPC, which additionally
 * runs under the protected write path and releases the fenced reservation);
 * the email is best-effort.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth first (cookie for web, Bearer for mobile).
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: 401 }
    );
  }

  // 2. CSRF (auto-skipped for Bearer requests inside checkCsrfProtection).
  const { valid: csrfValid, response: csrfResponse } =
    await checkCsrfProtection(request);
  if (!csrfValid) {
    return (
      csrfResponse ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const isAllowed = await checkRateLimit(
    auth.supabase,
    auth.user.id,
    'storefront_account_order_cancel',
    5,
    RATE_LIMIT_WINDOW_MINUTES
  );
  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: { 'Retry-After': RETRY_AFTER_SECONDS } }
    );
  }

  // 3. Validate the order id and body.
  const { id } = await params;
  if (!orderIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    rawBody = {};
  }
  const parsed = storefrontOrderCancellationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', code: 'invalid_input' },
      { status: 400 }
    );
  }

  // 4. Perform the cancellation via the SECURITY DEFINER RPC. REDVAULT
  // orders cancel through the scoped RPC: the generic one cannot write a
  // REDVAULT row (protected-path guard) and would leak the fenced units.
  // An unreadable row falls through to the generic RPC, which enforces
  // ownership itself.
  const { data: orderRow } = await auth.supabase
    .from('orders')
    .select('payment_method')
    .eq('id', id)
    .maybeSingle();
  const cancelRpc =
    (orderRow as { payment_method?: string } | null)?.payment_method ===
    'uba_redvault'
      ? 'cancel_uba_redvault_order_as_customer'
      : 'cancel_order_as_customer';
  const { data, error } = await auth.supabase.rpc(cancelRpc, {
    p_order_id: id,
    p_reason: parsed.data.reason ?? null,
  });

  if (error) {
    const message = error.message || '';
    const code = (error as { code?: string }).code;
    // Prefer the RPC's SQLSTATE (P0002 not found, P0001 ineligible); fall back to
    // the message in case PostgREST wraps it.
    if (code === 'P0002' || message.includes('order_not_found')) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (code === 'P0001' || message.includes('order_not_cancellable')) {
      return NextResponse.json(
        {
          error: 'This order can no longer be cancelled',
          code: 'order_not_cancellable',
        },
        { status: 409 }
      );
    }
    logger.error({
      message: `${cancelRpc} RPC failed`,
      orderId: id,
      error,
    });
    return NextResponse.json(
      { error: 'Failed to cancel order' },
      { status: 500 }
    );
  }

  const didCancel = data === true;

  // 5. Best-effort cancellation email. The order is already cancelled, so an
  // email failure must NOT fail the request.
  if (didCancel) {
    const emailResult = await sendOrderCancellationEmail({
      supabase: auth.supabase,
      orderId: id,
      cancelledBy: 'customer',
      reason: parsed.data.reason,
      refundAmount: 0,
    });
    if (!emailResult.success) {
      logger.error({
        message: 'Order cancelled but cancellation email failed',
        orderId: id,
        error: emailResult.error,
      });
    }
  }

  return NextResponse.json({ success: true, cancelled: didCancel });
}
