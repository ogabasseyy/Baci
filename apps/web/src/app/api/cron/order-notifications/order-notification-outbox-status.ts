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
  constructor(
    readonly outboxId: string,
    options: { cause: unknown }
  ) {
    super(
      `Failed to persist order notification outbox row ${outboxId}`,
      options
    );
    this.name = 'OutboxStatusUpdateError';
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
