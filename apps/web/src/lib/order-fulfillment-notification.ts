import { logger } from '@/lib/logger';
import { orderFulfillmentNotificationSchemas } from '@/lib/order-fulfillment-notification-schemas';
import { sendFulfillmentNotificationEmail } from '@/lib/order-fulfillment-notification-senders';
import type {
  FeatureSettingsRecord,
  FulfillmentOrderRecord,
  MerchantRecord,
  OrderFulfillmentNotificationEventType,
  OrderFulfillmentNotificationResult,
} from '@/lib/order-fulfillment-notification-types';
import { ORDER_WITH_ITEMS_QUERY } from '@/lib/order-queries';

interface SendOrderFulfillmentNotificationParams {
  beforeProviderDispatch?: () => Promise<void>;
  resetProviderDispatch?: () => Promise<void>;
  courierName?: string | null;
  estimatedDelivery?: string;
  eventType: OrderFulfillmentNotificationEventType;
  merchantId: string;
  mismatchBehavior?: 'skip' | 'invalid_state';
  orderId: string;
  supabase: {
    from: (table: string) => unknown;
  };
  trackingNumber?: string | null;
  trackingToken?: string | null;
}
type QueryBuilder = {
  eq: (column: string, value: unknown) => QueryBuilder;
  maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
  select: (columns: string) => QueryBuilder;
  single: () => Promise<{ data: unknown; error: unknown }>;
};

function tableQuery(
  supabase: SendOrderFulfillmentNotificationParams['supabase'],
  table: string
): QueryBuilder {
  return supabase.from(table) as QueryBuilder;
}

function isOrderInRequiredShippingStatus(
  eventType: OrderFulfillmentNotificationEventType,
  shippingStatus: FulfillmentOrderRecord['shipping_status'],
  allowHistoricalShippedEvent: boolean
): boolean {
  if (eventType === 'order_shipped') {
    if (allowHistoricalShippedEvent) {
      return ['completed', 'delivered', 'out_for_delivery', 'shipped'].includes(
        shippingStatus
      );
    }
    return (
      shippingStatus === 'shipped' || shippingStatus === 'out_for_delivery'
    );
  }

  if (eventType === 'order_delivery_failed' || eventType === 'order_returned') {
    // The GIG sync moves the order to 'failed' / 'returned' with the parcel, so
    // those are the event's own states. A failed-delivery email is stale once
    // the parcel is returned; anything never shipped, delivered or cancelled
    // would contradict the order's real state.
    const allowed = ['shipped', 'out_for_delivery', 'failed'];
    if (eventType === 'order_returned') allowed.push('returned');
    return allowed.includes(shippingStatus);
  }

  return shippingStatus === 'delivered' || shippingStatus === 'completed';
}

async function loadMerchant(
  supabase: SendOrderFulfillmentNotificationParams['supabase'],
  merchantId: string
): Promise<MerchantRecord | null | 'invalid' | 'query_error'> {
  const query = tableQuery(supabase, 'merchants')
    .select(
      'id, business_name, slug, support_email, email_sender_name, email, tax_identification_number, cac_rc_number'
    )
    .eq('id', merchantId);
  const { data, error } = query.maybeSingle
    ? await query.maybeSingle()
    : await query.single();

  if (error) {
    logger.error({
      message: 'Failed to load merchant for order notification',
      merchantId,
      error,
    });
    return 'query_error';
  }

  if (!data) return null;

  const parsed = orderFulfillmentNotificationSchemas.merchant.safeParse(data);
  if (!parsed.success) {
    logger.error({
      message: 'Invalid merchant payload for order notification',
      merchantId,
      error: parsed.error.flatten(),
    });
    return 'invalid';
  }

  return parsed.data;
}

async function loadOrder(
  supabase: SendOrderFulfillmentNotificationParams['supabase'],
  merchantId: string,
  orderId: string
): Promise<FulfillmentOrderRecord | null | 'invalid' | 'query_error'> {
  const query = tableQuery(supabase, 'orders')
    .select(ORDER_WITH_ITEMS_QUERY)
    .eq('id', orderId)
    .eq('merchant_id', merchantId);
  const { data, error } = query.maybeSingle
    ? await query.maybeSingle()
    : await query.single();

  if (error) {
    logger.error({
      message: 'Failed to load order for fulfillment notification',
      orderId,
      merchantId,
      error,
    });
    return 'query_error';
  }

  if (!data) return null;

  const parsed = orderFulfillmentNotificationSchemas.order.safeParse(data);
  if (!parsed.success) {
    logger.error({
      message: 'Invalid order payload for fulfillment notification',
      orderId,
      merchantId,
      error: parsed.error.flatten(),
    });
    return 'invalid';
  }

  return parsed.data;
}

async function loadFeatureSettings(
  supabase: SendOrderFulfillmentNotificationParams['supabase'],
  merchantId: string,
  orderId: string
): Promise<FeatureSettingsRecord | null> {
  const query = tableQuery(supabase, 'merchant_feature_settings')
    .select('google_place_id')
    .eq('merchant_id', merchantId);
  const { data, error } = query.maybeSingle
    ? await query.maybeSingle()
    : await query.single();

  if (error) {
    logger.warn({
      message:
        'Failed to fetch merchant feature settings for delivered notification',
      error,
      merchantId,
      orderId,
    });
    return null;
  }

  if (!data) return null;

  const parsed =
    orderFulfillmentNotificationSchemas.featureSettings.safeParse(data);
  if (!parsed.success) {
    logger.warn({
      message: 'Invalid merchant feature settings for delivered notification',
      error: parsed.error.flatten(),
      merchantId,
      orderId,
    });
    return null;
  }

  return parsed.data;
}

export async function sendOrderFulfillmentNotification({
  beforeProviderDispatch,
  courierName,
  estimatedDelivery,
  eventType,
  merchantId,
  mismatchBehavior = 'skip',
  orderId,
  resetProviderDispatch,
  supabase,
  trackingNumber,
  trackingToken,
}: SendOrderFulfillmentNotificationParams): Promise<OrderFulfillmentNotificationResult> {
  const [merchant, order] = await Promise.all([
    loadMerchant(supabase, merchantId),
    loadOrder(supabase, merchantId, orderId),
  ]);

  if (merchant === 'query_error' || order === 'query_error') {
    return {
      status: 'failed',
      error: 'Order notification data temporarily unavailable',
      details: { retryable: true },
    };
  }

  if (!merchant || !order) {
    return { status: 'not_found', error: 'Order or merchant not found' };
  }

  if (merchant === 'invalid') {
    return { status: 'failed', error: 'Invalid merchant payload' };
  }

  if (order === 'invalid') {
    return { status: 'failed', error: 'Invalid order payload' };
  }

  if (
    !isOrderInRequiredShippingStatus(
      eventType,
      order.shipping_status,
      mismatchBehavior === 'skip'
    )
  ) {
    if (mismatchBehavior === 'invalid_state') {
      const requiredStatus =
        eventType === 'order_shipped' ? 'shipped' : 'delivered';
      return {
        status: 'invalid_state',
        error: `Order must be marked as ${requiredStatus} first`,
      };
    }

    return { status: 'skipped', reason: 'order_not_in_required_status' };
  }

  if (
    (eventType === 'order_delivery_failed' || eventType === 'order_returned') &&
    trackingNumber &&
    (!order.tracking_number ||
      trackingNumber.trim().toUpperCase() !==
        order.tracking_number.trim().toUpperCase())
  ) {
    // The order moved on to a replacement shipment since this event was
    // queued: the previous parcel's failure/return is no longer the news.
    return { status: 'skipped', reason: 'order_not_in_required_status' };
  }

  if (eventType === 'order_shipped') {
    const snapshotOrder =
      trackingToken === undefined
        ? order
        : { ...order, tracking_token: trackingToken };
    return sendFulfillmentNotificationEmail({
      beforeProviderDispatch,
      courierName,
      estimatedDelivery,
      eventType,
      merchant,
      merchantId,
      order: snapshotOrder,
      resetProviderDispatch,
      trackingNumber,
    });
  }

  const featureSettings = await loadFeatureSettings(
    supabase,
    merchantId,
    orderId
  );
  return sendFulfillmentNotificationEmail({
    beforeProviderDispatch,
    eventType,
    featureSettings,
    merchant,
    merchantId,
    order,
    resetProviderDispatch,
  });
}
