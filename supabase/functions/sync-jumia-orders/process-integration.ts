import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { formatJumiaOrderTimestamp } from '../_shared/jumia-order-timestamp.ts';
import {
  formatJumiaAmount,
  getSuccessfullyNotifiedJumiaOrderIds,
  sendJumiaPushNotification,
} from './notifications.ts';
import { fetchAllJumiaOrders, type JumiaOrdersConfig } from './orders.ts';
import {
  type JumiaStockConfig,
  syncJumiaStockForIntegration,
} from './stock.ts';
import {
  getValidJumiaToken,
  type JumiaTokenConfig,
  refreshJumiaToken,
} from './token.ts';
import type { JumiaOrder, MarketplaceIntegration } from './types.ts';

interface ExistingOrderRow {
  jumia_order_id: string;
  id: string;
  notification_sent: boolean;
}

export interface JumiaIntegrationProcessResult {
  synced: number;
  newOrders: number;
  errors: string[];
}

export async function processJumiaIntegration(args: {
  supabase: SupabaseClient;
  integration: MarketplaceIntegration;
  tokenConfig: JumiaTokenConfig;
  ordersConfig: JumiaOrdersConfig;
  stockConfig: JumiaStockConfig;
}): Promise<JumiaIntegrationProcessResult> {
  const { supabase, integration, tokenConfig, ordersConfig, stockConfig } =
    args;
  try {
    const accessToken = await getValidJumiaToken(
      supabase,
      integration,
      tokenConfig
    );
    const syncStartedAt = formatJumiaOrderTimestamp(new Date());
    const updatedAfter = integration.last_sync_at
      ? formatJumiaOrderTimestamp(integration.last_sync_at)
      : formatJumiaOrderTimestamp(Date.now() - 24 * 60 * 60 * 1000);
    const orders = await fetchAllJumiaOrders(
      supabase,
      integration,
      accessToken,
      updatedAfter,
      syncStartedAt,
      ordersConfig,
      () => refreshJumiaToken(supabase, integration, tokenConfig)
    );

    console.log(
      `[Jumia Sync] Merchant ${integration.merchant_id}: ${orders.length} orders`
    );
    if (orders.length === 0) {
      const { error } = await supabase
        .from('marketplace_integrations')
        .update({ last_sync_at: syncStartedAt, sync_error: null })
        .eq('id', integration.id);
      if (error) {
        console.error(
          `[Jumia Sync] Failed to update last_sync_at for merchant ${integration.merchant_id} (zero orders):`,
          error.message
        );
      }
      return { synced: 0, newOrders: 0, errors: [] };
    }

    const CHUNK_SIZE = 500;
    const orderIds = orders.map((order) => order.id);
    const existingOrdersData: ExistingOrderRow[] = [];
    let existingOrdersError: { message: string } | null = null;
    for (let i = 0; i < orderIds.length; i += CHUNK_SIZE) {
      const chunk = orderIds.slice(i, i + CHUNK_SIZE);
      const { data, error } = await supabase
        .from('jumia_orders')
        .select('jumia_order_id, id, notification_sent')
        .eq('merchant_id', integration.merchant_id)
        .in('jumia_order_id', chunk);
      if (error) {
        existingOrdersError = error;
        break;
      }
      if (data) existingOrdersData.push(...data);
    }

    if (existingOrdersError) {
      console.error(
        `[Jumia Sync] Failed to fetch existing orders for merchant ${integration.merchant_id}:`,
        existingOrdersError
      );
      return {
        synced: 0,
        newOrders: 0,
        errors: [
          `${integration.merchant_id}: existing orders query failed — ${existingOrdersError.message}`,
        ],
      };
    }

    const existingOrderMap = new Map(
      existingOrdersData.map((row) => [row.jumia_order_id, row])
    );
    const upsertRows: Record<string, unknown>[] = [];
    const newOrderIds = new Set<string>();
    for (const order of orders) {
      const customerName = order.shippingAddress
        ? `${order.shippingAddress.firstName || ''} ${order.shippingAddress.lastName || ''}`.trim()
        : 'Unknown Customer';
      const isNewOrder = !existingOrderMap.has(order.id);
      const baseRow = {
        merchant_id: integration.merchant_id,
        jumia_order_id: order.id,
        jumia_order_number: String(order.number),
        jumia_shop_id: integration.shop_id,
        status: order.status,
        customer_name: customerName,
        shipping_address: order.shippingAddress || {},
        total_amount: order.totalAmount.value,
        currency: order.totalAmount.currency,
        created_at_jumia: order.createdAt,
      };
      upsertRows.push(
        isNewOrder
          ? {
              ...baseRow,
              customer_phone: '',
              items: [],
              notification_sent: false,
            }
          : baseRow
      );
      if (isNewOrder) newOrderIds.add(order.id);
    }

    const { error: upsertError } = await supabase
      .from('jumia_orders')
      .upsert(upsertRows, { onConflict: 'jumia_order_id' });
    let totalNewOrders = 0;
    if (upsertError) {
      console.error(
        `[Jumia Sync] Batch upsert error for merchant ${integration.merchant_id}:`,
        upsertError
      );
    } else {
      totalNewOrders = newOrderIds.size;
    }

    if (!upsertError && totalNewOrders > 0) {
      const { data: pushTokens } = await supabase
        .from('push_tokens')
        .select('token')
        .eq('merchant_id', integration.merchant_id)
        .eq('is_active', true);
      if (pushTokens && pushTokens.length > 0) {
        const notifiedOrderIds: string[] = [];
        const pushPromises: Promise<void>[] = [];
        for (const order of orders as JumiaOrder[]) {
          if (!newOrderIds.has(order.id)) continue;
          const customerName = order.shippingAddress
            ? `${order.shippingAddress.firstName || ''} ${order.shippingAddress.lastName || ''}`.trim()
            : 'Unknown Customer';
          const formattedAmount = formatJumiaAmount(
            order.totalAmount.value,
            order.totalAmount.currency
          );
          for (const { token } of pushTokens) {
            pushPromises.push(
              sendJumiaPushNotification(
                token,
                '🟠 Jumia Order',
                `Order #${order.number} from ${customerName} - ${formattedAmount}`,
                {
                  type: 'jumia_order',
                  jumia_order_number: String(order.number),
                  amount: order.totalAmount.value,
                  currency: order.totalAmount.currency,
                }
              )
            );
          }
          notifiedOrderIds.push(order.id);
        }
        const pushResults = await Promise.allSettled(pushPromises);
        const successfullyNotifiedOrderIds =
          getSuccessfullyNotifiedJumiaOrderIds(
            notifiedOrderIds,
            pushResults,
            pushTokens.length
          );
        if (successfullyNotifiedOrderIds.length > 0) {
          const { error } = await supabase
            .from('jumia_orders')
            .update({ notification_sent: true })
            .eq('merchant_id', integration.merchant_id)
            .in('jumia_order_id', successfullyNotifiedOrderIds);
          if (error) {
            console.error(
              `[Jumia Sync] Failed to mark orders as notified for merchant ${integration.merchant_id}:`,
              error.message
            );
          }
        }
      }
    }

    if (!upsertError) {
      const { error: syncUpdateError } = await supabase
        .from('marketplace_integrations')
        .update({ last_sync_at: syncStartedAt, sync_error: null })
        .eq('id', integration.id);
      if (syncUpdateError) {
        console.error(
          `[Jumia Sync] Failed to update last_sync_at for merchant ${integration.merchant_id}:`,
          syncUpdateError.message
        );
      }
    }

    if (integration.sync_config?.stock === true) {
      try {
        const stockToken = await getValidJumiaToken(
          supabase,
          integration,
          tokenConfig
        );
        const stockResult = await syncJumiaStockForIntegration({
          supabase,
          integration,
          accessToken: stockToken,
          config: stockConfig,
          refreshToken: () =>
            refreshJumiaToken(supabase, integration, tokenConfig),
        });
        if (stockResult.updated > 0) {
          console.log(
            `[Jumia Sync] Stock: pushed ${stockResult.updated} updates for merchant ${integration.merchant_id}`
          );
        }
      } catch (stockError) {
        const stockMessage =
          stockError instanceof Error
            ? stockError.message
            : 'Unknown stock sync error';
        console.error(
          `[Jumia Sync] Stock sync error for merchant ${integration.merchant_id}:`,
          stockMessage
        );
      }
    }

    return {
      synced: upsertError ? 0 : orders.length,
      newOrders: totalNewOrders,
      errors: upsertError
        ? [
            `${integration.merchant_id}: upsert failed for orders [${upsertRows.map((row) => row.jumia_order_id as string).join(', ')}] — ${upsertError.message}`,
          ]
        : [],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(
      `[Jumia Sync] Error for merchant ${integration.merchant_id}:`,
      errorMessage
    );
    await supabase
      .from('marketplace_integrations')
      .update({ sync_error: errorMessage })
      .eq('id', integration.id);
    return {
      synced: 0,
      newOrders: 0,
      errors: [`${integration.merchant_id}: ${errorMessage}`],
    };
  }
}
