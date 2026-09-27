import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { getTrackedCustomerCancellationProducts } from '@/lib/get-tracked-customer-cancellation-products';
import { logger } from '@/lib/logger';
import { sendOrderCancellationEmail } from '@/lib/order-cancellation-email';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';
import { checkRateLimit } from '@/lib/rate-limiter';
import { scheduleOrderProductBlogPurgeAfterResponse } from '@/lib/schedule-order-product-blog-purge-after-response';
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
  // An unreadable row (null data, no error) falls through to the generic
  // RPC, which enforces ownership itself. A lookup ERROR fails closed
  // instead: treating it as an ordinary order would misroute a REDVAULT
  // cancellation into the generic RPC and 500.
  const { data: orderRow, error: orderLookupError } = await auth.supabase
    .from('orders')
    .select('payment_method, merchant_id, order_items(product_id, variant_id)')
    .eq('id', id)
    .maybeSingle();
  if (orderLookupError) {
    logger.error({
      message: 'Order payment-method lookup failed before cancellation',
      orderId: id,
      error: orderLookupError,
    });
    return NextResponse.json(
      {
        error: 'Could not load the order. Please try again.',
        code: 'order_lookup_failed',
      },
      { status: 503 }
    );
  }
  const preCancelOrder = orderRow as {
    payment_method?: string;
    merchant_id?: string | null;
    order_items?: unknown;
  } | null;
  // Snapshot the merchant + items BEFORE the RPC commits: if the
  // post-cancellation reread below fails, this snapshot still identifies the
  // caches to evict (neither value can change across the cancel RPC).
  const preCancelSnapshot = preCancelOrder?.merchant_id?.trim()
    ? {
        merchant_id: preCancelOrder.merchant_id.trim(),
        order_items: Array.isArray(preCancelOrder.order_items)
          ? preCancelOrder.order_items
          : [],
      }
    : null;
  const cancelRpc =
    preCancelOrder?.payment_method === 'uba_redvault'
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

  // The customer cancellation RPC restocks managed inventory, but it cannot
  // invalidate the storefront's Next/Cloudflare caches. Resolve the owning
  // merchant and order products after the atomic transition, then queue the
  // same best-effort purge flow used by checkout and merchant cancellation.
  // This stays after the RPC so an idempotent retry (data === false) does not
  // churn product or article caches a second time.
  if (didCancel) {
    try {
      const { data: cancelledOrder, error: cancelledOrderError } =
        await auth.supabase
          .from('orders')
          .select('merchant_id, order_items(product_id, variant_id)')
          .eq('id', id)
          .maybeSingle();
      // The restock already committed: fall back to the pre-cancellation
      // snapshot when the reread fails so the purge still runs.
      const effectiveOrder = cancelledOrder ?? preCancelSnapshot;
      if (!effectiveOrder) {
        throw cancelledOrderError ?? new Error('Cancelled order not found');
      }
      if (!cancelledOrder) {
        logger.warn({
          message:
            'Cancelled order reread failed; purging from pre-cancellation snapshot',
          orderId: id,
          error: cancelledOrderError,
        });
      }

      const typedOrder = effectiveOrder as unknown as {
        merchant_id?: string | null;
        order_items?: unknown;
      };
      const orderItems = (
        Array.isArray(typedOrder.order_items) ? typedOrder.order_items : []
      ).filter(
        (item): item is { product_id?: unknown; variant_id?: unknown } =>
          typeof item === 'object' && item !== null
      );
      const productIds = Array.from(
        new Set(
          orderItems
            .map((item) => item.product_id)
            .filter(
              (productId): productId is string =>
                typeof productId === 'string' && productId.trim().length > 0
            )
            .map((productId) => productId.trim())
        )
      );
      const merchantId = typedOrder.merchant_id?.trim();
      if (merchantId && productIds.length > 0) {
        const trackedProducts = await getTrackedCustomerCancellationProducts({
          merchantId,
          orderItems,
          productIds,
          supabase: auth.supabase,
        });
        const trackedProductIds = trackedProducts.map((product) => product.id);
        const slugs = trackedProducts
          .map((product) => product.slug)
          .filter((slug): slug is string => Boolean(slug?.trim()))
          .map((slug) => slug.trim());
        if (slugs.length > 0) {
          productCacheRevalidation.revalidateProductSlugs(merchantId, slugs);
        }

        if (trackedProductIds.length > 0) {
          try {
            productCacheRevalidation.revalidateProducts(merchantId, undefined, {
              feedScope: 'merchant',
            });
          } catch (productCacheError) {
            logger.error({
              message:
                'Failed to revalidate product caches after customer cancellation',
              orderId: id,
              merchantId,
              error: productCacheError,
            });
          }
          scheduleOrderProductBlogPurgeAfterResponse({
            merchantId,
            productIds: trackedProductIds,
            supabase: auth.supabase,
          });
        }
      }
    } catch (cacheError) {
      // Cancellation is already committed. Cache invalidation remains
      // best-effort; the product/article TTLs self-heal if this read fails.
      logger.error({
        message: 'Failed to queue product caches after customer cancellation',
        orderId: id,
        error: cacheError,
      });
    }
  }

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
