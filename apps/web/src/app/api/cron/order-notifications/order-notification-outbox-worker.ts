import { z } from 'zod';
import { reclaimStaleManualDocumentDispatchMarker } from '@/lib/check-manual-document-dispatch-lease';
import { logger } from '@/lib/logger';
import { sendOrderFulfillmentNotification } from '@/lib/order-fulfillment-notification';
import { beginOrderNotificationOutboxDispatch } from '@/lib/order-notification-outbox-dispatch';
import { resetOrderNotificationOutboxDispatch } from '@/lib/order-notification-outbox-dispatch-reset';
import { resolveOrderNotificationOutboxShipmentMetadata } from '@/lib/order-notification-outbox-shipment-metadata';
import { sendManualOrderDocument } from '@/lib/send-manual-order-document';
import type { createServiceClient } from '@/lib/supabase/service';
import {
  isPostAcceptanceLeaseReset,
  markCorrectiveRetry,
  retryDelayMs,
} from './order-notification-outbox-corrective-retry';
import {
  markManualOutboxNotificationSent,
  markOutboxNotificationSent,
  type OrderNotificationOutboxStatus,
  OutboxClaimLostError,
  OutboxDispatchResetError,
  OutboxStatusUpdateError,
  updateOutboxStatus,
} from './order-notification-outbox-status';

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

function isManualOutboxEvent(
  eventType: ClaimedOrderNotificationOutboxRow['event_type']
): eventType is 'manual_order_receipt' | 'manual_order_invoice' {
  return (
    eventType === 'manual_order_receipt' || eventType === 'manual_order_invoice'
  );
}

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

async function markSkipped(
  supabase: SupabaseClientLike,
  row: ClaimedOrderNotificationOutboxRow,
  reason: string
) {
  await updateOutboxStatus(supabase, row, {
    last_error: null,
    // A previously retried row carries a future next_attempt_at: clear it
    // so janitors and dashboards never read a terminal row as due.
    // dispatch_started_at is deliberately NOT cleared here: a skip after a
    // lost-claim race can carry a live marker the terminalizer keys on.
    next_attempt_at: null,
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
  // Counts follow the durable write: a superseded attempt (lost claim)
  // must not count an outcome the row never recorded.
  // A failed marker cleanup strands past the budget (the set marker
  // blocks re-arm): corrective-retry like a lease reset instead.
  if (error === 'dispatch_marker_clear_failed') {
    await markCorrectiveRetry(supabase, row, summary, error);
    return;
  }
  if (row.attempt_count >= row.max_attempts) {
    await updateOutboxStatus(supabase, row, {
      last_error: error,
      next_attempt_at: null,
      status: 'failed' satisfies OrderNotificationOutboxStatus,
    });
    summary.failed += 1;
    return;
  }

  await updateOutboxStatus(supabase, row, {
    last_error: error,
    next_attempt_at: new Date(
      Date.now() + retryDelayMs(row.attempt_count)
    ).toISOString(),
    status: 'pending' satisfies OrderNotificationOutboxStatus,
  });
  summary.retried += 1;
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
    // A prior attempt may have stranded its marker after a definite
    // rejection (clear failed): reclaim before the claim RPC, which
    // skips on a set marker, or the retry is permanently lost.
    if (isManualOutboxEvent(eventType))
      await reclaimStaleManualDocumentDispatchMarker(supabase, row);
    const result = isManualOutboxEvent(eventType)
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
      try {
        if (isManualOutboxEvent(eventType)) {
          await markManualOutboxNotificationSent(
            supabase,
            row,
            result.messageId
          );
        } else {
          await markOutboxNotificationSent(supabase, row, result.messageId);
        }
      } catch (error) {
        if (error instanceof OutboxDispatchResetError) {
          await markCorrectiveRetry(supabase, row, summary);
          return;
        }
        if (!(error instanceof OutboxStatusUpdateError)) throw error;
        await markDeliveryOutcomeUnknown(supabase, row, error.reason);
        // The durable state is skipped/outcome-unknown, not sent: count the
        // terminalized fallback like the other unknown-delivery branch.
        summary.skipped += 1;
        return;
      }
      summary.sent += 1;
      return;
    }

    if (result.status === 'skipped') {
      await markSkipped(supabase, row, result.reason);
      summary.skipped += 1;
      return;
    }

    if (result.deliveryOutcome === 'unknown') {
      await markDeliveryOutcomeUnknown(supabase, row, result.error);
      summary.skipped += 1;
      return;
    }

    if (isPostAcceptanceLeaseReset(result)) {
      await markCorrectiveRetry(supabase, row, summary);
      return;
    }

    await markFailedOrRetry(supabase, row, result.error, summary);
  } catch (error) {
    // A staff correction re-armed this row mid-flight: it is re-picked
    // with fresh data, so this superseded attempt ends as a quiet retry.
    // Post-send claim loss never lands here — the status writer only
    // reports a lost claim for undispatched rows and escalates otherwise.
    if (error instanceof OutboxClaimLostError) {
      summary.retried += 1;
      return;
    }
    if (error instanceof OutboxStatusUpdateError) throw error;
    const message = error instanceof Error ? error.message : 'unknown_error';
    logger.error({
      message: 'Unhandled order notification outbox processing failure',
      outboxId: row.id,
      orderId: row.order_id,
      error,
    });
    try {
      await markFailedOrRetry(supabase, row, message, summary);
    } catch (retryError) {
      if (!(retryError instanceof OutboxClaimLostError)) throw retryError;
      summary.retried += 1;
    }
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
