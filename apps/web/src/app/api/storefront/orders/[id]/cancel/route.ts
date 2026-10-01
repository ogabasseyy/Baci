import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { checkRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { createAnonClient } from '@/lib/supabase/anon';
import { storefrontOrderCancellationSchema } from '@/schemas/storefront-order-cancellation';

const orderIdSchema = z.uuid();
const guestCancelSchema = storefrontOrderCancellationSchema.extend({
  tracking_token: z
    .string()
    .trim()
    .min(1, 'Tracking token is required')
    .max(200, 'Tracking token is too long'),
});

/**
 * POST /api/storefront/orders/[id]/cancel
 *
 * Lets an unauthenticated guest cancel their own guest-owned order while it
 * is still cancellable. No session is read: the order's tracking token,
 * issued at creation and persisted by the checkout client, is the
 * order-bound proof. Serves both web guests (lane switches that must release
 * a stale prepared order) and mobile guests (REDVAULT review dismissal after
 * an app restart left no session).
 *
 * No CSRF check: like POST /api/orders, guests hold no CSRF token, and a
 * cross-site attacker cannot mint the unguessable tracking token the body
 * must carry. Abuse is mitigated by IP rate limiting, Zod shape validation,
 * and the token-gated SECURITY DEFINER RPC (guest-owned rows only), which
 * performs the state transition + restock + instrument voiding atomically.
 *
 * No notification email is sent here: the tracking-token RPC authorizes the
 * transition, not a general backend client, so this endpoint deliberately
 * constructs no service-role client and reaches no mail authority. Callers
 * confirm the cancellation in-app from the response. If guest cancellation
 * mail is ever required, enqueue it from inside the constrained RPC (or a
 * dedicated outbox), not from this request graph.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimit = await checkRateLimit(request);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(
      rateLimit.limit,
      rateLimit.remaining,
      rateLimit.resetTime
    );
  }

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
  const parsed = guestCancelSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', code: 'invalid_input' },
      { status: 400 }
    );
  }

  // Least privilege: the dispatcher RPC is granted to anon and verifies the
  // tracking token itself, so no service-role client touches the write path.
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc(
    'cancel_storefront_order_as_guest' as never,
    {
      p_order_id: id,
      p_tracking_token: parsed.data.tracking_token,
      p_reason: parsed.data.reason ?? null,
    } as never
  );

  if (error) {
    const message = error.message || '';
    const code = (error as { code?: string }).code;
    // Prefer the RPC's SQLSTATE (P0002 not found, P0001 ineligible); fall back to
    // the message in case PostgREST wraps it. Wrong tokens and attached orders
    // both surface as not found so the endpoint is not an order oracle.
    if (code === 'P0002' || message.includes('order_not_found')) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (
      code === 'P0001' ||
      message.includes('order_not_cancellable') ||
      message.includes('redvault_guest_cancel_active')
    ) {
      return NextResponse.json(
        {
          error: 'This order can no longer be cancelled',
          code: 'order_not_cancellable',
        },
        { status: 409 }
      );
    }
    logger.error({
      message: 'cancel_storefront_order_as_guest RPC failed',
      orderId: id,
      error,
    });
    return NextResponse.json(
      { error: 'Failed to cancel order' },
      { status: 500 }
    );
  }

  const didCancel = data === true;

  return NextResponse.json({ success: true, cancelled: didCancel });
}
