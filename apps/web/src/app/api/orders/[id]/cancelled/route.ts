import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { isInventoryTrackedProduct } from '@/lib/is-inventory-tracked-product';
import { logger } from '@/lib/logger';
import { productCacheRevalidation } from '@/lib/product-cache-revalidation';
import { scheduleOrderProductBlogPurgeAfterResponse } from '@/lib/schedule-order-product-blog-purge-after-response';
import { merchantOrderCancellationSchema } from '@/schemas/orders';

/**
 * POST /api/orders/[id]/cancelled
 * Atomically cancels a merchant-owned order and queues trusted refund/email work.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const { id } = await params;
    console.log(`[OrderCancelled] Starting for order ${id}`);

    let requestBody: unknown = {};
    try {
      requestBody = await request.json();
    } catch {
      // Validation below rejects missing explicit cancellation confirmation.
    }
    const parsedBody = merchantOrderCancellationSchema.safeParse(requestBody);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid cancellation request', code: 'INVALID_REQUEST_BODY' },
        { status: 400 }
      );
    }
    const cancellationReason = parsedBody.data.reason;

    // Get merchant ID
    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const supabase = auth.supabase;

    const { data: cancellationPerformed, error: cancellationError } =
      await supabase.rpc('cancel_order_as_merchant', {
        p_order_id: id,
        p_reason: cancellationReason,
      });
    if (cancellationError) {
      const status =
        cancellationError.code === 'P0002'
          ? 404
          : cancellationError.code === 'P0001'
            ? 409
            : cancellationError.code === '42501'
              ? 403
              : 500;
      return NextResponse.json(
        {
          error:
            status === 409
              ? 'This order can no longer be cancelled.'
              : status === 404
                ? 'Order not found'
                : status === 403
                  ? 'You do not have permission to cancel this order.'
                  : 'Failed to cancel order',
          code: status === 409 ? 'ORDER_NOT_CANCELLABLE' : undefined,
        },
        { status }
      );
    }
    const alreadyCancelled = !cancellationPerformed;

    productCacheRevalidation.revalidateDashboard(merchantId);
    try {
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('order_items')
        .select('product_id, variant_id')
        .eq('order_id', id);
      if (orderItemsError) throw orderItemsError;
      const productIds = Array.from(
        new Set(
          (orderItems ?? [])
            .map((item) => item.product_id)
            .filter((productId): productId is string => Boolean(productId))
        )
      );
      if (productIds.length > 0) {
        const { data: products, error: productsError } = await supabase
          .from('products')
          .select('id, slug, manage_stock, inventory_tracking_policy')
          .eq('merchant_id', merchantId)
          .in('id', productIds);
        if (productsError) {
          scheduleOrderProductBlogPurgeAfterResponse({
            merchantId,
            productIds,
            supabase,
          });
          throw productsError;
        }
        const productsNeedingVariantLookup = new Set(
          (products ?? [])
            .filter((product) => !isInventoryTrackedProduct(product))
            .map((product) => product.id)
        );
        const variantIds = Array.from(
          new Set(
            (orderItems ?? [])
              .filter((item) =>
                productsNeedingVariantLookup.has(item.product_id)
              )
              .map((item) => item.variant_id)
              .filter((variantId): variantId is string => Boolean(variantId))
          )
        );
        const serializedVariantProductIds = new Set<string>();
        let variantPolicyLookupFailed = false;
        if (variantIds.length > 0) {
          const { data: variants, error: variantsError } = await supabase
            .from('product_variants')
            .select('id, product_id, inventory_tracking_policy')
            .eq('merchant_id', merchantId)
            .in('id', variantIds);
          if (variantsError) {
            variantPolicyLookupFailed = true;
            // A variant projection failure must not suppress cache invalidation
            // for the parent product. The parent policy is still authoritative;
            // serialized child coverage is best-effort for this side effect.
            logger.error({
              error: variantsError,
              merchantId,
              orderId: id,
              message:
                'Failed to resolve variant inventory policies after cancellation',
            });
          } else {
            for (const variant of variants ?? []) {
              if (
                isInventoryTrackedProduct(
                  { id: variant.product_id, manage_stock: false },
                  [variant]
                )
              ) {
                serializedVariantProductIds.add(variant.product_id);
              }
            }
          }
        }
        const trackedProducts = (products ?? []).filter((product) =>
          variantPolicyLookupFailed &&
          productsNeedingVariantLookup.has(product.id)
            ? true
            : isInventoryTrackedProduct(product, [
                ...(serializedVariantProductIds.has(product.id)
                  ? [
                      {
                        product_id: product.id,
                        inventory_tracking_policy: 'serialized_strict',
                      },
                    ]
                  : []),
              ])
        );
        if (trackedProducts.length > 0) {
          productCacheRevalidation.revalidateProducts(merchantId, undefined, {
            feedScope: 'merchant',
          });
          productCacheRevalidation.revalidateProductSlugs(
            merchantId,
            trackedProducts.map((product) => product.slug)
          );
          scheduleOrderProductBlogPurgeAfterResponse({
            merchantId,
            productIds: trackedProducts.map((product) => product.id),
            supabase,
          });
        }
      }
    } catch (error) {
      productCacheRevalidation.revalidateProducts(merchantId, undefined, {
        feedScope: 'merchant',
      });
      logger.error({
        error,
        message: 'Failed to revalidate product caches after cancellation',
        merchantId,
        orderId: id,
      });
    }

    return NextResponse.json(
      {
        success: true,
        alreadyCancelled,
        message: 'Cancellation completed; side effects are queued',
        sideEffects: { customerEmail: 'queued', refund: 'queued_if_required' },
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Error';
    console.error('Error cancelling order:', error);
    logger.error({ message: 'Order cancellation route failed', error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
