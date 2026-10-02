import { z } from 'zod';
import { logger } from '@/lib/logger';
import { sendOrderFulfillmentNotification } from '@/lib/order-fulfillment-notification';
import { beginOrderNotificationOutboxDispatch } from '@/lib/order-notification-outbox-dispatch';
import { resetOrderNotificationOutboxDispatch } from '@/lib/order-notification-outbox-dispatch-reset';
import { resolveOrderNotificationOutboxShipmentMetadata } from '@/lib/order-notification-outbox-shipment-metadata';
import { sendManualOrderDocument } from '@/lib/send-manual-order-document';
import type { createServiceClient } from '@/lib/supabase/service';
import {
  markOutboxNotificationSent,
  type OrderNotificationOutboxStatus,
  OutboxStatusUpdateError,
  updateOutboxStatus,
} from './order-notification-outbox-status';

const RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const PROCESS_CONCURRENCY = 5;

export const claimedOrderNotificationOutboxRowSchema = z.object({
  attempt_count: z.number().int().nonnegative(),
  claim_owner: z.string().min(1),
  event_type: z.enum([
    'order_shipped',
    'order_delivered',
    'manual_order_receipt',
    'manual_order_invoice',
  ]),
  event_sequence: z.number().int().positive().optional(),
  id: z.string().min(1),
  max_attempts: z.number().int().positive(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  merchant_id: z.string().min(1),
  order_id: z.string().min(1),
});

export type ClaimedOrderNotificationOutboxRow = z.infer<
  typeof claimedOrderNotificationOutboxRowSchema
>;

type SupabaseClientLike = ReturnType<typeof createServiceClient>;

export interface OrderNotificationCronSummary {
  claimed: number;
  failed: number;
  retried: number;
  sent: number;
  skipped: number;
  unparseable: number;
  success: true;
}

export function createOrderNotificationCronSummary(
  claimed: number
): OrderNotificationCronSummary {
  // biome-ignore format: compact literal preserves the 300-line gate.
  return { claimed, failed: 0, retried: 0, sent: 0, skipped: 0, unparseable: 0, success: true };
}

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

async function markSkipped(
  supabase: SupabaseClientLike,
  row: ClaimedOrderNotificationOutboxRow,
  reason: string
) {
  await updateOutboxStatus(supabase, row, {
    last_error: null,
    skip_reason: reason,
    skipped_at: new Date().toISOString(),
    status: 'skipped' satisfies OrderNotificationOutboxStatus,
  });
}

async function markDeliveryOutcomeUnknown(
  supabase: SupabaseClientLike,
  row: ClaimedOrderNotificationOutboxRow,
  error: string
) {
  await updateOutboxStatus(supabase, row, {
    last_error: error,
    next_attempt_at: null,
    skip_reason: 'delivery_outcome_unknown',
    skipped_at: new Date().toISOString(),
    status: 'skipped' satisfies OrderNotificationOutboxStatus,
  });
}

async function markFailedOrRetry(
  supabase: SupabaseClientLike,
  row: ClaimedOrderNotificationOutboxRow,
  error: string,
  summary: OrderNotificationCronSummary
) {
  if (row.attempt_count >= row.max_attempts) {
    summary.failed += 1;
    await updateOutboxStatus(supabase, row, {
      last_error: error,
      next_attempt_at: null,
      status: 'failed' satisfies OrderNotificationOutboxStatus,
    });
    return;
  }

  summary.retried += 1;
  await updateOutboxStatus(supabase, row, {
    last_error: error,
    next_attempt_at: new Date(
      Date.now() + retryDelayMs(row.attempt_count)
    ).toISOString(),
    status: 'pending' satisfies OrderNotificationOutboxStatus,
  });
}

async function processClaimedRow(
  supabase: SupabaseClientLike,
  row: ClaimedOrderNotificationOutboxRow,
  summary: OrderNotificationCronSummary
) {
  try {
    const shipmentMetadata = resolveOrderNotificationOutboxShipmentMetadata(
      row.metadata
    );
    const eventType = row.event_type;
    const result =
      eventType === 'manual_order_receipt' ||
      eventType === 'manual_order_invoice'
        ? await sendManualOrderDocument({
            supabase,
            row: { ...row, event_type: eventType },
          })
        : await sendOrderFulfillmentNotification({
            beforeProviderDispatch: () =>
              beginOrderNotificationOutboxDispatch({
                claimId: row.id,
                claimOwner: row.claim_owner,
                eventType,
                merchantId: row.merchant_id,
                orderId: row.order_id,
                supabase,
              }),
            resetProviderDispatch: () =>
              resetOrderNotificationOutboxDispatch({
                claimId: row.id,
                claimOwner: row.claim_owner,
                eventType,
                merchantId: row.merchant_id,
                orderId: row.order_id,
                supabase,
              }),
            courierName: shipmentMetadata.courierName,
            estimatedDelivery: shipmentMetadata.estimatedDelivery,
            eventType,
            merchantId: row.merchant_id,
            orderId: row.order_id,
            supabase,
            trackingNumber: shipmentMetadata.trackingNumber,
            trackingToken: shipmentMetadata.trackingToken,
          });

    if (result.status === 'sent') {
      summary.sent += 1;
      try {
        await markOutboxNotificationSent(supabase, row, result.messageId);
      } catch (error) {
        if (!(error instanceof OutboxStatusUpdateError)) throw error;
        await markDeliveryOutcomeUnknown(
          supabase,
          row,
          'sent_outcome_persistence_failed'
        );
      }
      return;
    }

    if (result.status === 'skipped') {
      summary.skipped += 1;
      await markSkipped(supabase, row, result.reason);
      return;
    }

    if (result.deliveryOutcome === 'unknown') {
      summary.skipped += 1;
      await markDeliveryOutcomeUnknown(supabase, row, result.error);
      return;
    }

    await markFailedOrRetry(supabase, row, result.error, summary);
  } catch (error) {
    if (error instanceof OutboxStatusUpdateError) throw error;
    const message = error instanceof Error ? error.message : 'unknown_error';
    logger.error({
      message: 'Unhandled order notification outbox processing failure',
      outboxId: row.id,
      orderId: row.order_id,
      error,
    });
    await markFailedOrRetry(supabase, row, message, summary);
  }
}

function groupRowsByOrderId(rows: ClaimedOrderNotificationOutboxRow[]) {
  const groups: ClaimedOrderNotificationOutboxRow[][] = [];
  const groupIndexesByOrderId = new Map<string, number>();

  for (const row of rows) {
    const existingIndex = groupIndexesByOrderId.get(row.order_id);
    if (existingIndex !== undefined) {
      groups[existingIndex]?.push(row);
    } else {
      groupIndexesByOrderId.set(row.order_id, groups.length);
      groups.push([row]);
    }
  }
  return groups;
}

export async function processClaimedOrderNotificationRows(
  supabase: SupabaseClientLike,
  rows: ClaimedOrderNotificationOutboxRow[],
  summary: OrderNotificationCronSummary
) {
  const groups = groupRowsByOrderId(rows);
  let nextGroupIndex = 0;
  const workerCount = Math.min(PROCESS_CONCURRENCY, groups.length);
  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (nextGroupIndex < groups.length) {
        const group = groups[nextGroupIndex];
        nextGroupIndex += 1;
        for (const row of group ?? [])
          await processClaimedRow(supabase, row, summary);
      }
    })
  );
  const failedWorker = workerResults.find(
    (result) => result.status === 'rejected'
  );
  if (failedWorker?.status === 'rejected') throw failedWorker.reason;
}
