import { logger } from '@/lib/logger';
import type { createServiceClient } from '@/lib/supabase/service';

export type OrderNotificationOutboxStatus =
  | 'pending'
  | 'sent'
  | 'skipped'
  | 'failed';
type SupabaseClientLike = ReturnType<typeof createServiceClient>;

export interface OutboxStatusRow {
  id: string;
  claim_owner: string;
}

export class OutboxStatusUpdateError extends Error {
  readonly reason: string;
  constructor(
    readonly outboxId: string,
    options: { cause: unknown; reason?: string }
  ) {
    super(
      `Failed to persist order notification outbox row ${outboxId}`,
      options
    );
    this.name = 'OutboxStatusUpdateError';
    this.reason = options.reason ?? 'sent_outcome_persistence_failed';
  }
}

export class OutboxDispatchResetError extends Error {
  constructor(readonly outboxId: string) {
    super(`Dispatch marker was reset for outbox row ${outboxId}`);
    this.name = 'OutboxDispatchResetError';
  }
}

export async function updateOutboxStatus(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow,
  values: Record<string, unknown>
) {
  try {
    const { data, error } = await supabase
      .from('order_notification_outbox')
      .update({
        ...values,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .match({
        id: row.id,
        locked_by: row.claim_owner,
        status: 'processing',
      })
      .select('id')
      .maybeSingle();
    if (!error && data?.id === row.id) return;
    throw error ?? new Error('order notification claim was lost');
  } catch (error) {
    logger.error({
      message: 'Failed to update order notification outbox row',
      outboxId: row.id,
      error,
    });
    throw new OutboxStatusUpdateError(row.id, { cause: error });
  }
}

async function readLiveOutboxMetadata(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow
): Promise<Record<string, unknown>> {
  try {
    const { data: current, error: readError } = await supabase
      .from('order_notification_outbox')
      .select('metadata')
      .match({ id: row.id, locked_by: row.claim_owner, status: 'processing' })
      .maybeSingle();
    if (readError || !current) {
      throw readError ?? new Error('order notification claim was lost');
    }
    return current.metadata &&
      typeof current.metadata === 'object' &&
      !Array.isArray(current.metadata)
      ? (current.metadata as Record<string, unknown>)
      : {};
  } catch (error) {
    // Normalize like the status writes: the email was already sent, so a
    // failed re-read must terminalize as outcome-unknown, never retry into
    // a double send.
    logger.error({
      message: 'Failed to re-read order notification outbox row',
      outboxId: row.id,
      error,
    });
    throw new OutboxStatusUpdateError(row.id, { cause: error });
  }
}

export async function markOutboxNotificationSent(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow,
  messageId: string | undefined
) {
  // Re-read: the sender may have snapshotted dispatch metadata (e.g. the
  // sent document kind) after this row was claimed; merging the message ID
  // into the live value preserves it instead of clobbering the row with
  // the stale claim-time copy.
  const liveMetadata = await readLiveOutboxMetadata(supabase, row);
  await updateOutboxStatus(supabase, row, {
    last_error: null,
    metadata: {
      ...liveMetadata,
      ...(messageId ? { message_id: messageId } : {}),
    },
    sent_at: new Date().toISOString(),
    status: 'sent' satisfies OrderNotificationOutboxStatus,
  });
}

export async function markManualOutboxNotificationSent(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow,
  messageId: string | undefined
) {
  // The sender's standalone lease read cannot cover the gap before this
  // write: verify the dispatch marker atomically inside the sent
  // transition, or a data change landing between the two records a stale
  // PDF as cleanly sent. A reset row retries with fresh data; only a
  // genuinely lost claim terminalizes as outcome-unknown.
  const liveMetadata = await readLiveOutboxMetadata(supabase, row);
  try {
    const { data, error } = await supabase
      .from('order_notification_outbox')
      .update({
        last_error: null,
        metadata: {
          ...liveMetadata,
          ...(messageId ? { message_id: messageId } : {}),
        },
        sent_at: new Date().toISOString(),
        status: 'sent' satisfies OrderNotificationOutboxStatus,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .match({
        id: row.id,
        locked_by: row.claim_owner,
        status: 'processing',
      })
      .not('dispatch_started_at', 'is', null)
      .select('id')
      .maybeSingle();
    if (!error && data?.id === row.id) return;
    const { data: current, error: classifyError } = await supabase
      .from('order_notification_outbox')
      .select('dispatch_started_at, locked_by, status')
      .match({ id: row.id })
      .maybeSingle();
    if (classifyError) {
      // A failed classify read is neither a confirmed reset (retry would
      // risk a double send) nor a confirmed loss: terminalize unknown
      // with a distinct reason instead of the generic claim-lost path.
      logger.error({
        message: 'Failed to classify zero-row manual sent update',
        outboxId: row.id,
        error: classifyError,
      });
      throw new OutboxStatusUpdateError(row.id, {
        cause: classifyError,
        reason: 'sent_outcome_classify_failed',
      });
    }
    if (
      current?.status === 'processing' &&
      current.locked_by === row.claim_owner &&
      current.dispatch_started_at == null
    ) {
      throw new OutboxDispatchResetError(row.id);
    }
    throw error ?? new Error('order notification claim was lost');
  } catch (error) {
    if (
      error instanceof OutboxDispatchResetError ||
      error instanceof OutboxStatusUpdateError
    )
      throw error;
    logger.error({
      message: 'Failed to update order notification outbox row',
      outboxId: row.id,
      error,
    });
    throw new OutboxStatusUpdateError(row.id, { cause: error });
  }
}
