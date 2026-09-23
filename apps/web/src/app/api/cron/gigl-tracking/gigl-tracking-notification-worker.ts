import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  type NotificationSendResult,
  notifyCustomer,
  notifyMerchant,
} from '@/lib/expo-push';
import { maybeNotifyActivateProtection } from '@/lib/insurance/notify-activate-protection';
import { logger } from '@/lib/logger';
import type { Database } from '@/types/supabase';
import { buildGiglTrackingMerchantPushPayload } from './build-gigl-tracking-merchant-push-payload';
import { copyFor } from './gigl-tracking-notification-copy';

const claimedNotificationSchema = z.object({
  audience: z.enum(['merchant', 'customer']),
  id: z.uuid(),
  merchant_id: z.uuid(),
  notification_kind: z.string().min(1),
  // Repair-pickup outbox rows may be orderless; shipment_id is the durable key.
  order_id: z.uuid().nullable(),
  // Projected by claim_shipment_tracking_notifications for orderless pickups.
  repair_id: z.uuid().nullable().optional(),
  shipment_id: z.uuid(),
  tracking_event_id: z.uuid(),
});

export const claimedGiglTrackingNotificationsSchema = z.array(
  claimedNotificationSchema
);
export type ClaimedGiglTrackingNotification = z.infer<
  typeof claimedNotificationSchema
>;

type WorkerSupabase = SupabaseClient<Database>;
type NotificationProcessingState = { rejectionCompleted: boolean };

const SHIPMENT_UPDATE_CAPABILITY = 1;

async function complete(
  supabase: WorkerSupabase,
  id: string,
  workerId: string,
  outcome: 'sent' | 'skipped' | 'failed' | 'rejected',
  error?: string
): Promise<boolean> {
  const { data, error: rpcError } = await supabase.rpc(
    'complete_shipment_tracking_notification',
    {
      ...(error ? { p_error: error } : {}),
      p_id: id,
      p_outcome: outcome,
      p_worker_id: workerId,
    }
  );
  if (rpcError) throw rpcError;
  return data === true;
}

async function processNotification(
  supabase: WorkerSupabase,
  notification: ClaimedGiglTrackingNotification,
  workerId: string,
  processingState: NotificationProcessingState
) {
  const { data: event, error: eventError } = await supabase
    .from('shipment_tracking_events')
    .select('description')
    .eq('id', notification.tracking_event_id)
    .maybeSingle();
  if (eventError || !event)
    throw eventError ?? new Error('Tracking event missing');

  const copy = copyFor(notification.notification_kind, event.description);
  if (notification.notification_kind === 'delivered' && notification.order_id) {
    await notifyDeliveredProtectionActivation(
      notification.order_id,
      notification.merchant_id
    );
  }
  let deliveryRejected = false;
  const onDeliveryStart = async () => {
    const { data: started, error: beginError } = await supabase.rpc(
      'begin_shipment_tracking_notification_dispatch',
      { p_id: notification.id, p_worker_id: workerId }
    );
    if (beginError) throw beginError;
    if (!started) {
      throw new Error(
        'Tracking notification dispatch lease is no longer active'
      );
    }
  };
  const onDeliveryRejected = async () => {
    deliveryRejected = true;
    processingState.rejectionCompleted = await complete(
      supabase,
      notification.id,
      workerId,
      'rejected',
      'all_push_tickets_rejected'
    );
  };
  if (notification.audience === 'merchant') {
    const payload = buildGiglTrackingMerchantPushPayload(notification);
    const result = await notifyMerchant(
      notification.merchant_id,
      copy.title,
      copy.body,
      payload,
      'orders',
      {
        onDeliveryStart,
        onDeliveryRejected,
        requiredShipmentUpdateCapability: SHIPMENT_UPDATE_CAPABILITY,
      }
    );
    return completeNotificationResult(
      supabase,
      notification.id,
      workerId,
      result,
      deliveryRejected,
      processingState.rejectionCompleted
    );
  }

  if (!notification.order_id) {
    await complete(
      supabase,
      notification.id,
      workerId,
      'skipped',
      'orderless_repair_pickup'
    );
    return 'skipped' as const;
  }
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('customer_id')
    .eq('id', notification.order_id)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order?.customer_id) {
    await complete(
      supabase,
      notification.id,
      workerId,
      'skipped',
      'customer_missing'
    );
    return 'skipped' as const;
  }
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('user_id')
    .eq('id', order.customer_id)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer?.user_id) {
    await complete(
      supabase,
      notification.id,
      workerId,
      'skipped',
      'customer_user_missing'
    );
    return 'skipped' as const;
  }
  const payload = {
    orderId: notification.order_id,
    type: 'shipment_tracking',
  };
  const result = await notifyCustomer(
    customer.user_id,
    copy.title,
    copy.body,
    payload,
    'orders',
    {
      merchantId: notification.merchant_id,
      onDeliveryStart,
      onDeliveryRejected,
      requiredShipmentUpdateCapability: SHIPMENT_UPDATE_CAPABILITY,
    }
  );
  return completeNotificationResult(
    supabase,
    notification.id,
    workerId,
    result,
    deliveryRejected,
    processingState.rejectionCompleted
  );
}

async function notifyDeliveredProtectionActivation(
  orderId: string,
  merchantId: string
) {
  try {
    await maybeNotifyActivateProtection(orderId, merchantId);
  } catch (error) {
    logger.error({
      message: 'Failed to send activate-protection push after GIGL delivery',
      orderId,
      error,
    });
  }
}

async function completeNotificationResult(
  supabase: WorkerSupabase,
  id: string,
  workerId: string,
  result: NotificationSendResult,
  deliveryRejected: boolean,
  rejectionCompleted: boolean
) {
  if (rejectionCompleted) return 'failed' as const;
  // A retry after any accepted ticket can duplicate a customer-visible update.
  if (result.sent > 0) {
    await complete(supabase, id, workerId, 'sent');
    return 'sent' as const;
  }
  if (result.errors.length > 0 || result.failed > 0) {
    await complete(
      supabase,
      id,
      workerId,
      deliveryRejected ? 'rejected' : 'failed'
    );
    return 'failed' as const;
  }
  await complete(supabase, id, workerId, 'skipped', 'no_active_push_token');
  return 'skipped' as const;
}

export async function processClaimedGiglTrackingNotifications(
  supabase: WorkerSupabase,
  notifications: ClaimedGiglTrackingNotification[],
  workerId: string
) {
  const summary = {
    claimed: notifications.length,
    failed: 0,
    sent: 0,
    skipped: 0,
    success: true,
  };
  for (const notification of notifications) {
    const processingState: NotificationProcessingState = {
      rejectionCompleted: false,
    };
    try {
      const outcome = await processNotification(
        supabase,
        notification,
        workerId,
        processingState
      );
      summary[outcome] += 1;
    } catch (error) {
      logger.error({
        message: 'GIGL tracking notification failed',
        notificationId: notification.id,
        error,
      });
      if (!processingState.rejectionCompleted) {
        try {
          await complete(
            supabase,
            notification.id,
            workerId,
            'failed',
            error instanceof Error ? error.message : 'unknown_error'
          );
        } catch (completionError) {
          logger.error({
            message: 'Failed to record GIGL tracking notification failure',
            notificationId: notification.id,
            error: completionError,
          });
        }
      }
      summary.failed += 1;
    }
  }
  return summary;
}
