import {
  notifyCustomerWithStore,
  notifyMerchantWithStore,
} from '@/lib/expo-push-core';
import type { NotificationSendResult } from '@/lib/expo-push-types';
import type { GiglNotificationRpcClient } from '@/lib/gigl-notification-worker-client';
import { logger } from '@/lib/logger';
import { buildGiglTrackingMerchantPushPayload } from './build-gigl-tracking-merchant-push-payload';
import { createGiglNotificationPushStore } from './gigl-notification-push-store';
import { notifyGiglDeliveredProtection } from './gigl-tracking-delivered-protection';
import {
  type ClaimedGiglTrackingNotification,
  claimedGiglTrackingNotificationsSchema,
} from './gigl-tracking-notification-claim-schema';
import { completeGiglTrackingNotification as complete } from './gigl-tracking-notification-complete';
import { copyFor } from './gigl-tracking-notification-copy';

export type { ClaimedGiglTrackingNotification };
export { claimedGiglTrackingNotificationsSchema };

type WorkerSupabase = GiglNotificationRpcClient;
// Completion is deferred until ticket processing and attempt recording have
// written under the still-active lease.
type NotificationProcessingState = { deliveryRejected: boolean };

const SHIPMENT_UPDATE_CAPABILITY = 1;

async function processNotification(
  supabase: WorkerSupabase,
  notification: ClaimedGiglTrackingNotification,
  workerId: string,
  processingState: NotificationProcessingState
) {
  const { data: eventRows, error: eventError } = await supabase.rpc(
    'gigl_worker_notification_event',
    { p_id: notification.id, p_worker_id: workerId }
  );
  const event = (eventRows as { description: string | null }[] | null)?.[0];
  if (eventError || !event)
    throw eventError ?? new Error('Tracking event missing');
  const store = createGiglNotificationPushStore(supabase, {
    notificationId: notification.id,
    workerId,
  });

  const copy = copyFor(
    notification.notification_kind,
    event.description ?? '',
    notification.audience
  );
  if (
    notification.notification_kind === 'delivered' &&
    notification.audience === 'customer' &&
    notification.order_id
  ) {
    await notifyDeliveredProtectionActivation(
      supabase,
      { notificationId: notification.id, workerId },
      notification.order_id,
      notification.merchant_id
    );
  }
  const onDeliveryStart = async () => {
    const { data: started, error: beginError } = await supabase.rpc(
      'gigl_worker_begin_notification_dispatch',
      { p_id: notification.id, p_worker_id: workerId }
    );
    if (beginError) throw beginError;
    if (!started) {
      throw new Error(
        'Tracking notification dispatch lease is no longer active'
      );
    }
  };
  const onDeliveryRejected = () => {
    processingState.deliveryRejected = true;
  };
  if (notification.audience === 'merchant') {
    if (!notification.recipient_user_ids) {
      // The claim RPC predates the recipient column (rollout window). Leave the
      // lease untouched, without begin/complete, so the row is re-claimed after
      // it expires and no delivery attempt is consumed. Never broadcast.
      logger.warn({
        message: 'GIGL merchant notification claimed without recipient list',
        notificationId: notification.id,
      });
      return 'skipped' as const;
    }
    const payload = buildGiglTrackingMerchantPushPayload(notification);
    const result = await notifyMerchantWithStore(
      store,
      notification.merchant_id,
      copy.title,
      copy.body,
      payload,
      'orders',
      {
        onDeliveryStart,
        onDeliveryRejected,
        requiredShipmentUpdateCapability: SHIPMENT_UPDATE_CAPABILITY,
        recipientUserIds: notification.recipient_user_ids,
      }
    );
    return completeNotificationResult(
      supabase,
      notification.id,
      workerId,
      result,
      processingState.deliveryRejected
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
  const { data: customerRows, error: customerError } = await supabase.rpc(
    'gigl_worker_notification_customer',
    { p_id: notification.id, p_worker_id: workerId }
  );
  if (customerError) throw customerError;
  const customer = (
    customerRows as { customer_user_id: string | null }[] | null
  )?.[0];
  if (!customer) {
    await complete(
      supabase,
      notification.id,
      workerId,
      'skipped',
      'customer_missing'
    );
    return 'skipped' as const;
  }
  if (!customer.customer_user_id) {
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
    event: notification.notification_kind,
  };
  const result = await notifyCustomerWithStore(
    store,
    customer.customer_user_id,
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
    processingState.deliveryRejected
  );
}

async function notifyDeliveredProtectionActivation(
  supabase: WorkerSupabase,
  lease: { notificationId: string; workerId: string },
  orderId: string,
  merchantId: string
) {
  try {
    await notifyGiglDeliveredProtection(supabase, lease, merchantId, orderId);
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
  deliveryRejected: boolean
) {
  if (deliveryRejected) {
    await complete(
      supabase,
      id,
      workerId,
      'rejected',
      'all_push_tickets_rejected'
    );
    return 'failed' as const;
  }
  // A retry after any accepted ticket can duplicate a customer-visible update.
  if (result.sent > 0) {
    await complete(supabase, id, workerId, 'sent');
    return 'sent' as const;
  }
  if (result.errors.length > 0 || result.failed > 0) {
    await complete(supabase, id, workerId, 'failed');
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
      deliveryRejected: false,
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
      try {
        await (processingState.deliveryRejected
          ? complete(
              supabase,
              notification.id,
              workerId,
              'rejected',
              'all_push_tickets_rejected'
            )
          : complete(
              supabase,
              notification.id,
              workerId,
              'failed',
              error instanceof Error ? error.message : 'unknown_error'
            ));
      } catch (completionError) {
        logger.error({
          message: 'Failed to record GIGL tracking notification failure',
          notificationId: notification.id,
          error: completionError,
        });
      }
      summary.failed += 1;
    }
  }
  return summary;
}
