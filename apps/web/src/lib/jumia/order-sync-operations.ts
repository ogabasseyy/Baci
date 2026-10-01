import type { SupabaseClient } from '@supabase/supabase-js';
import { type NotificationSendResult, notifyMerchant } from '@/lib/expo-push';
import type { JumiaOrder, JumiaOrderItem } from '@/schemas/jumia';
import type {
  ExistingJumiaOrderRow,
  ExistingOrderRow,
  JumiaCacheRow,
  MarketplaceIntegrationRow,
} from './order-sync-mappers';
import {
  buildCanonicalJumiaOrderPayload,
  buildJumiaCacheRow,
  buildJumiaOrderNumber,
  buildOrderItems,
  buildTrackingToken,
  getCustomerName,
  JUMIA_EXTERNAL_SOURCE,
} from './order-sync-mappers';

const ORDER_LOOKUP_BATCH_SIZE = 100;
const JUMIA_NOTIFICATION_LOCALE = 'en-NG';
const FALLBACK_JUMIA_CURRENCY = 'NGN';

export function chunkOrderIds(orderIds: string[]) {
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < orderIds.length;
    index += ORDER_LOOKUP_BATCH_SIZE
  ) {
    chunks.push(orderIds.slice(index, index + ORDER_LOOKUP_BATCH_SIZE));
  }
  return chunks;
}

export function buildExistingJumiaCacheEntry(
  jumiaOrderId: string,
  notificationSent: boolean | null,
  baciOrderId: string
) {
  return {
    jumia_order_id: jumiaOrderId,
    notification_sent: notificationSent,
    baci_order_id: baciOrderId,
  };
}

export async function loadExistingJumiaOrders(
  supabase: SupabaseClient,
  merchantId: string,
  orderIds: string[]
) {
  if (orderIds.length === 0) return new Map<string, ExistingJumiaOrderRow>();
  const rows: ExistingJumiaOrderRow[] = [];

  const results = await Promise.all(
    chunkOrderIds(orderIds).map((orderIdChunk) =>
      supabase
        .from('jumia_orders')
        .select('jumia_order_id, notification_sent, baci_order_id')
        .eq('merchant_id', merchantId)
        .in('jumia_order_id', orderIdChunk)
        .returns<ExistingJumiaOrderRow[]>()
    )
  );

  for (const { data, error } of results) {
    if (error) throw new Error(`Failed to load Jumia orders: ${error.message}`);
    rows.push(...(data || []));
  }

  return new Map(rows.map((row) => [row.jumia_order_id, row]));
}

export async function loadExistingCanonicalOrders(
  supabase: SupabaseClient,
  merchantId: string,
  orderIds: string[]
) {
  if (orderIds.length === 0) return new Map<string, ExistingOrderRow>();
  const rows: ExistingOrderRow[] = [];

  const results = await Promise.all(
    chunkOrderIds(orderIds).map((orderIdChunk) =>
      supabase
        .from('orders')
        .select('id, external_id, tracking_token')
        .eq('merchant_id', merchantId)
        .eq('external_source', JUMIA_EXTERNAL_SOURCE)
        .in('external_id', orderIdChunk)
        .returns<ExistingOrderRow[]>()
    )
  );

  for (const { data, error } of results) {
    if (error) throw new Error(`Failed to load Baci orders: ${error.message}`);
    rows.push(...(data || []));
  }

  return new Map(
    rows
      .filter((row): row is ExistingOrderRow & { external_id: string } =>
        Boolean(row.external_id)
      )
      .map((row) => [row.external_id, row])
  );
}

export async function upsertCanonicalOrder(
  supabase: SupabaseClient,
  integration: MarketplaceIntegrationRow,
  order: JumiaOrder,
  items: JumiaOrderItem[],
  existing: ExistingOrderRow | undefined
) {
  const payload = buildCanonicalJumiaOrderPayload(
    integration,
    order,
    existing?.tracking_token && existing.tracking_token.trim().length > 0
      ? existing.tracking_token
      : buildTrackingToken(),
    items
  );
  let persistedOrder = existing;
  let createdOrderId: string | null = null;

  if (existing) {
    const orderItems = buildOrderItems(existing.id, items);
    const { error } = await supabase.rpc(
      'replace_order_items_suppressing_order_notifications',
      {
        p_order_id: existing.id,
        p_items: orderItems,
        p_merchant_id: integration.merchant_id,
        p_order_patch: payload,
      }
    );
    if (error) {
      throw new Error(`Failed to update Baci order: ${error.message}`);
    }
    // Downstream sync only needs these stable identifiers; the full row update
    // happens inside the RPC transaction with the item replacement.
    return existing;
  } else {
    const { data, error } = await supabase
      .from('orders')
      .insert(payload)
      .select('id, external_id, tracking_token')
      .single<ExistingOrderRow>();
    if (error || !data) {
      throw new Error(`Failed to create Baci order: ${error?.message}`);
    }
    persistedOrder = data;
    createdOrderId = persistedOrder.id;
  }

  if (!persistedOrder) throw new Error('Failed to persist Baci order');

  const orderItems = buildOrderItems(persistedOrder.id, items);
  const { error: replaceItemsError } = await supabase.rpc(
    'replace_order_items',
    {
      p_order_id: persistedOrder.id,
      p_items: orderItems,
      p_merchant_id: integration.merchant_id,
    }
  );
  if (replaceItemsError) {
    if (createdOrderId) {
      const { error: cleanupError } = await supabase
        .from('orders')
        .delete()
        .eq('id', createdOrderId)
        .eq('merchant_id', integration.merchant_id);
      if (cleanupError) {
        throw new Error(
          `Failed to replace Jumia order items: ${replaceItemsError.message}; also failed to delete incomplete Baci order ${createdOrderId}: ${cleanupError.message}`
        );
      }
    }
    throw new Error(
      `Failed to replace Jumia order items: ${replaceItemsError.message}`
    );
  }

  return persistedOrder;
}

export function buildSyncedJumiaCacheRow(
  integration: MarketplaceIntegrationRow,
  order: JumiaOrder,
  items: JumiaOrderItem[],
  existing: ExistingJumiaOrderRow | undefined,
  baciOrderId: string
): JumiaCacheRow {
  // Keep the sync layer isolated from the lower-level cache row mapper.
  return buildJumiaCacheRow(integration, order, items, existing, baciOrderId);
}

// Module-scope cache: locale is static; currency varies per order.
const jumiaCurrencyFormatterCache = new Map<string, Intl.NumberFormat>();
function getJumiaCurrencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = jumiaCurrencyFormatterCache.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(JUMIA_NOTIFICATION_LOCALE, {
      currency,
      style: 'currency',
    });
    jumiaCurrencyFormatterCache.set(currency, formatter);
  }
  return formatter;
}

export function formatJumiaOrderAmount(order: JumiaOrder) {
  const amount = getJumiaOrderAmount(order);

  try {
    return getJumiaCurrencyFormatter(amount.currency).format(amount.value);
  } catch {
    return `${amount.currency} ${amount.value.toLocaleString(JUMIA_NOTIFICATION_LOCALE)}`;
  }
}

function getJumiaOrderAmount(order: JumiaOrder) {
  const totalAmount = order.totalAmount;
  if (
    !totalAmount ||
    typeof totalAmount.value !== 'number' ||
    !Number.isFinite(totalAmount.value)
  ) {
    return { currency: FALLBACK_JUMIA_CURRENCY, value: 0 };
  }

  return {
    currency: totalAmount.currency || FALLBACK_JUMIA_CURRENCY,
    value: totalAmount.value,
  };
}

export async function notifySyncedJumiaOrder(
  merchantId: string,
  order: JumiaOrder,
  baciOrderId: string,
  options?: { excludeTokens?: string[] }
): Promise<NotificationSendResult> {
  const amount = getJumiaOrderAmount(order);
  const result = await notifyMerchant(
    merchantId,
    'Jumia Order',
    `Order #${order.number} from ${getCustomerName(order)} - ${formatJumiaOrderAmount(order)}`,
    {
      type: 'new_order',
      source: JUMIA_EXTERNAL_SOURCE,
      order_id: baciOrderId,
      order_number: buildJumiaOrderNumber(order.number),
      jumia_order_id: order.id,
      amount: amount.value,
      currency: amount.currency,
    },
    'orders',
    options
  );
  return result ?? { sent: 0, failed: 0, errors: [] };
}
