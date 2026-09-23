import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { notifyJumiaOrder } from '@/lib/expo-push';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  JumiaApiError,
  JumiaClient,
  jumiaErrorResponse,
} from '@/lib/jumia/client';
import { getJumiaManualOrderCacheKey } from '@/lib/jumia/get-jumia-manual-order-cache-key';
import { getJumiaOrderQueryFilters } from '@/lib/jumia/order-query-filters';
import { formatJumiaOrderTimestamp } from '@/lib/jumia/order-sync-mappers';
import { getAllOrders, getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { sanitizeText } from '@/lib/sanitize-core';
import { createClient } from '@/lib/supabase/server';
import { getCachedJumiaOrders } from './get-cached-jumia-orders';
import { getJumiaShopNonDefaultMarketplaceKeys } from './get-jumia-order-scope';

export const GET = getCachedJumiaOrders;

export async function POST(request: NextRequest) {
  try {
    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;
    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    const { searchParams } = new URL(request.url);
    const rawIntegrationId = searchParams.get('integrationId');

    if (!rawIntegrationId) {
      return NextResponse.json(
        { error: 'integrationId is required' },
        { status: 400 }
      );
    }

    const integrationIdSchema = z.uuid('integrationId must be a valid UUID');
    const parsedIntegrationId = integrationIdSchema.safeParse(rawIntegrationId);
    if (!parsedIntegrationId.success) {
      return NextResponse.json(
        {
          error: 'Invalid integrationId',
          code: 'invalid_integration_id',
        },
        { status: 400 }
      );
    }
    const integrationId = parsedIntegrationId.data;

    // Map JumiaApiError from forIntegration to appropriate HTTP responses
    let jumiaClient: JumiaClient;
    try {
      jumiaClient = await JumiaClient.forIntegration(
        supabase,
        merchantId,
        integrationId
      );
    } catch (clientError) {
      if (clientError instanceof JumiaApiError) {
        return jumiaErrorResponse(clientError);
      }
      throw clientError;
    }

    // A shop shared by several business clients returns one unattributable
    // order set. Stamp the selected key only when the scope is unambiguous;
    // otherwise keep the neutral scope (and fail closed to it on lookup
    // errors) so sibling syncs cannot churn rows between marketplaces.
    const shopMarketplaceKeys = await getJumiaShopNonDefaultMarketplaceKeys(
      supabase,
      merchantId,
      jumiaClient.shopId
    );
    const ambiguousOrderScope =
      !(shopMarketplaceKeys instanceof Set) || shopMarketplaceKeys.size > 1;
    if (!(shopMarketplaceKeys instanceof Set)) {
      logger.error({
        message: 'Failed to resolve Jumia shop marketplace scope',
        error: shopMarketplaceKeys.message,
      });
    }

    // Fetch all orders from Jumia (auto-paginating) — last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const jumiaOrders = await getAllOrders(jumiaClient, {
      createdAfter: sevenDaysAgo.toISOString().split('T')[0],
      ...getJumiaOrderQueryFilters({
        shopId: jumiaClient.shopId,
        countryCode: jumiaClient.countryCode,
        marketplaceKey: jumiaClient.marketplaceKey,
      }),
    });

    // Sync to our database
    let newOrdersCount = 0;

    for (const order of jumiaOrders) {
      const customerName = order.shippingAddress
        ? `${order.shippingAddress.firstName || ''} ${order.shippingAddress.lastName || ''}`.trim() ||
          'Unknown Customer'
        : 'Unknown Customer';

      const { data: existingOrder, error: existingOrderError } = await supabase
        .from('jumia_orders')
        .select('id, notification_sent')
        .eq('jumia_order_id', order.id)
        .eq('merchant_id', merchantId)
        .maybeSingle();

      if (existingOrderError) {
        logger.error({
          message: 'Failed to look up existing Jumia order',
          orderId: order.id,
          error: existingOrderError,
        });
        continue;
      }

      const isNewOrder = !existingOrder;

      let itemsFetched = false;
      let orderItems: Array<{
        id: string;
        product: { name: string; sellerSku: string; imageUrl: string };
        status: string;
        itemPrice: number;
        paidPrice: number;
      }> = [];
      try {
        const itemsResponse = await getOrderItems(jumiaClient, order.id);
        orderItems = itemsResponse.items.map((item) => ({
          id: item.id,
          product: item.product,
          status: item.status,
          itemPrice: item.itemPrice,
          paidPrice: item.paidPrice,
        }));
        itemsFetched = true;
      } catch (itemError) {
        logger.error({
          message: 'Failed to fetch items for Jumia order',
          orderId: order.id,
          error:
            itemError instanceof Error
              ? { message: itemError.message, stack: itemError.stack }
              : itemError,
        });
      }

      const shippingAddr = order.shippingAddress as
        | (Record<string, unknown> & { phone?: string })
        | undefined;
      const customerPhone =
        typeof shippingAddr?.phone === 'string' ? shippingAddr.phone : '';

      const sanitizedCustomerName = sanitizeText(customerName, 200);
      const sanitizedShippingAddress = order.shippingAddress
        ? Object.fromEntries(
            Object.entries(
              order.shippingAddress as Record<string, unknown>
            ).map(([k, v]) => [
              k,
              typeof v === 'string' ? sanitizeText(v, 500) : v,
            ])
          )
        : {};
      const upsertPayload: Record<string, unknown> = {
        merchant_id: merchantId,
        jumia_order_id: order.id,
        jumia_order_number: String(order.number),
        jumia_shop_id: jumiaClient.shopId,
        marketplace_key: getJumiaManualOrderCacheKey(
          jumiaClient.marketplaceKey,
          { ambiguousScope: ambiguousOrderScope }
        ),
        status: order.status,
        customer_name: sanitizedCustomerName,
        customer_phone: sanitizeText(customerPhone, 50),
        shipping_address: sanitizedShippingAddress,
        total_amount: order.totalAmount?.value ?? 0,
        currency: order.totalAmount?.currency ?? 'NGN',
        created_at_jumia: order.createdAt,
        notification_sent: existingOrder?.notification_sent || false,
      };

      if (itemsFetched) {
        const sanitizedItems = orderItems.map((item) => ({
          ...item,
          product: {
            ...item.product,
            name: sanitizeText(item.product.name, 300),
          },
        }));
        upsertPayload.items = sanitizedItems;
      }

      const { error: upsertError } = await supabase
        .from('jumia_orders')
        .upsert(upsertPayload, { onConflict: 'jumia_order_id' });

      if (upsertError) {
        console.error('[Jumia Orders] Upsert error:', upsertError);
        continue;
      }

      if (isNewOrder) {
        newOrdersCount++;
        try {
          await notifyJumiaOrder(
            merchantId,
            String(order.number),
            sanitizedCustomerName,
            Number(order.totalAmount?.value ?? 0),
            order.totalAmount?.currency ?? 'NGN'
          );

          // Only mark notification_sent after successful notify
          const { error: notifyUpdateError } = await supabase
            .from('jumia_orders')
            .update({ notification_sent: true })
            .eq('jumia_order_id', order.id)
            .eq('merchant_id', merchantId);
          if (notifyUpdateError) {
            logger.error({
              message: 'Failed to update notification_sent flag',
              orderId: order.id,
              error: notifyUpdateError,
            });
          }
        } catch (pushError) {
          logger.error({
            message: 'Push notification failed for Jumia order',
            orderId: order.id,
            orderNumber: order.number,
            error:
              pushError instanceof Error
                ? { message: pushError.message, stack: pushError.stack }
                : pushError,
          });
        }
      }
    }

    // Update last_sync_at only on THIS integration row
    const { error: syncUpdateError } = await supabase
      .from('marketplace_integrations')
      .update({
        last_sync_at: formatJumiaOrderTimestamp(new Date()),
        sync_error: null,
      })
      .eq('id', integrationId)
      .eq('merchant_id', merchantId);

    if (syncUpdateError) {
      console.error(
        '[Jumia Orders] Failed to update last_sync_at:',
        syncUpdateError
      );
    }

    return NextResponse.json({
      success: true,
      synced: jumiaOrders.length,
      newOrders: newOrdersCount,
      message: `Synced ${jumiaOrders.length} orders (${newOrdersCount} new)`,
    });
  } catch (error) {
    console.error('[Jumia Orders] Sync error:', error);
    return NextResponse.json({ error: 'Order sync failed' }, { status: 500 });
  }
}
