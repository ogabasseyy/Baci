import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyJumiaOrder } from '@/lib/expo-push';
import type { JumiaClient } from '@/lib/jumia/client';
import { getJumiaManualOrderCacheKey } from '@/lib/jumia/get-jumia-manual-order-cache-key';
import { getJumiaOrderQueryFilters } from '@/lib/jumia/order-query-filters';
import { formatJumiaOrderTimestamp } from '@/lib/jumia/order-sync-mappers';
import { getAllOrders, getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';
import { sanitizeText } from '@/lib/sanitize-core';
import { getJumiaShopNonDefaultMarketplaceKeys } from './get-jumia-order-scope';

export interface JumiaManualOrderSyncResult {
  synced: number;
  newOrders: number;
}

/**
 * Runs a manual Jumia order sync for one integration: resolves whether the
 * shop scope is ambiguous, fetches the last 7 days of provider orders, and
 * upserts them into the order cache with per-row notifications.
 */
export async function syncJumiaManualOrders(args: {
  supabase: SupabaseClient;
  merchantId: string;
  integrationId: string;
  jumiaClient: JumiaClient;
}): Promise<JumiaManualOrderSyncResult> {
  const { supabase, merchantId, integrationId, jumiaClient } = args;

  // A shop shared by several business clients returns one unattributable
  // order set. Stamp the selected key only when the scope is unambiguous;
  // otherwise keep the neutral scope so sibling syncs cannot churn rows
  // between marketplaces.
  const shopMarketplaceKeys = await getJumiaShopNonDefaultMarketplaceKeys(
    supabase,
    merchantId,
    jumiaClient.shopId,
    {
      // OAuth order queries are shop-wide (the collapsed country_code is
      // not a request filter), so only country-scope the count when the
      // provider fetch itself is country-scoped.
      countryCode:
        jumiaClient.marketplaceKey === 'oauth'
          ? undefined
          : jumiaClient.countryCode,
    }
  );
  if (!(shopMarketplaceKeys instanceof Set)) {
    // A scope lookup failure must abort the sync: continuing would stamp
    // orders with the neutral key, clear sync_error, and report success
    // while multi-marketplace rows stay hidden from scoped reads.
    logger.error({
      message: 'Failed to resolve Jumia shop marketplace scope',
      error: shopMarketplaceKeys.message,
    });
    const { error: syncErrorUpdateError } = await supabase
      .from('marketplace_integrations')
      .update({
        sync_error: `Failed to resolve Jumia shop marketplace scope: ${shopMarketplaceKeys.message}`,
      })
      .eq('id', integrationId)
      .eq('merchant_id', merchantId);
    if (syncErrorUpdateError) {
      logger.error({
        message: 'Failed to persist Jumia manual sync scope error',
        error: syncErrorUpdateError,
      });
    }
    throw new Error(
      `Failed to resolve Jumia shop marketplace scope: ${shopMarketplaceKeys.message}`
    );
  }
  const ambiguousOrderScope = shopMarketplaceKeys.size > 1;

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
          Object.entries(order.shippingAddress as Record<string, unknown>).map(
            ([k, v]) => [k, typeof v === 'string' ? sanitizeText(v, 500) : v]
          )
        )
      : {};
    const upsertPayload: Record<string, unknown> = {
      merchant_id: merchantId,
      jumia_order_id: order.id,
      jumia_order_number: String(order.number),
      jumia_shop_id: jumiaClient.shopId,
      marketplace_key: getJumiaManualOrderCacheKey(jumiaClient.marketplaceKey, {
        ambiguousScope: ambiguousOrderScope,
      }),
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

  return { synced: jumiaOrders.length, newOrders: newOrdersCount };
}
