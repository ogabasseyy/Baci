import { logger } from '@/lib/logger';
import type { createServiceClient } from '@/lib/supabase/service';
import type { OutboxMergeGuard } from './order-notification-outbox-guard';
import { canonicalizeOutboxMetadataForGuard } from './order-notification-outbox-guard';

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

// A staff correction re-armed this row mid-flight: undispatched, safely
// re-picked, so the superseded attempt ends quietly (never a 500).
// biome-ignore format: compact error preserves the 300-line gate.
export class OutboxClaimLostError extends Error {
  constructor(readonly outboxId: string) { super(`Order notification outbox claim was lost for row ${outboxId}`); this.name = 'OutboxClaimLostError'; }
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
  values: Record<string, unknown>,
  guard?: OutboxMergeGuard
) {
  try {
    const updater = supabase.from('order_notification_outbox').update({
      ...values,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    });
    // Optional optimistic guard for read-merge-write sent transitions: a
    // write landing between the live re-read and this update must abort
    // (zero rows) instead of being clobbered by the stale merged copy.
    // Terminal writes pass no guard; they set full scalar values.
    let guarded = updater;
    if (guard) {
      guarded =
        guard.metadataRaw === null
          ? guarded.is('metadata', null)
          : guarded.eq(
              'metadata',
              canonicalizeOutboxMetadataForGuard(guard.metadataRaw)
            );
      guarded =
        guard.updatedAt === null
          ? guarded.is('updated_at', null)
          : guarded.eq('updated_at', guard.updatedAt);
    }
    const { data, error } = await guarded
      .match({
        id: row.id,
        locked_by: row.claim_owner,
        status: 'processing',
      })
      .select('id')
      .maybeSingle();
    if (!error && data?.id === row.id) return;
    if (!error) {
      // Zero rows, no database error: a correction re-armed the row
      // mid-flight. Classify on the dispatch marker — undispatched rows
      // are safely re-picked, but a lost claim after dispatch started
      // must escalate: quiet retry there could double-send.
      const { data: current, error: classifyError } = await supabase
        .from('order_notification_outbox')
        .select('dispatch_started_at')
        .match({ id: row.id })
        .maybeSingle();
      if (!classifyError && current?.dispatch_started_at == null)
        throw new OutboxClaimLostError(row.id);
    }
    throw error ?? new Error('order notification claim was lost');
  } catch (error) {
    if (error instanceof OutboxClaimLostError) throw error;
    logger.error({
      message: 'Failed to update order notification outbox row',
      outboxId: row.id,
      error,
    });
    throw new OutboxStatusUpdateError(row.id, { cause: error });
  }
}

async function readLiveOutboxMetadataForMerge(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow
): Promise<{
  base: Record<string, unknown>;
  raw: unknown;
  updatedAt: string | null;
}> {
  try {
    const { data: current, error: readError } = await supabase
      .from('order_notification_outbox')
      .select('metadata, updated_at')
      .match({ id: row.id, locked_by: row.claim_owner, status: 'processing' })
      .maybeSingle();
    if (readError || !current) {
      throw readError ?? new Error('order notification claim was lost');
    }
    return {
      base:
        current.metadata &&
        typeof current.metadata === 'object' &&
        !Array.isArray(current.metadata)
          ? (current.metadata as Record<string, unknown>)
          : {},
      raw: current.metadata ?? null,
      updatedAt:
        typeof current.updated_at === 'string' ? current.updated_at : null,
    };
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
  // the stale claim-time copy. The merge carries the same optimistic
  // guard as the manual path: a concurrent metadata write aborts into
  // outcome-unknown instead of losing keys (single attempt — races here
  // are exceptional, unlike the manual sender's mid-flight writes).
  const {
    base: liveMetadata,
    raw: liveRaw,
    updatedAt: liveUpdatedAt,
  } = await readLiveOutboxMetadataForMerge(supabase, row);
  await updateOutboxStatus(
    supabase,
    row,
    {
      last_error: null,
      metadata: {
        ...liveMetadata,
        ...(messageId ? { message_id: messageId } : {}),
      },
      sent_at: new Date().toISOString(),
      status: 'sent' satisfies OrderNotificationOutboxStatus,
    },
    { metadataRaw: liveRaw, updatedAt: liveUpdatedAt }
  );
}

const MANUAL_SENT_METADATA_RACE_RETRIES = 3;

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
  for (let attempt = 0; ; attempt++) {
    const {
      base: liveMetadata,
      raw: liveRaw,
      updatedAt: liveUpdatedAt,
    } = await readLiveOutboxMetadataForMerge(supabase, row);
    try {
      const updater = supabase.from('order_notification_outbox').update({
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
      });
      // Optimistic guard: a write landing between the re-read and this
      // update must abort the merge instead of being clobbered by the
      // stale copy. updated_at is the primary version: every outbox
      // writer bumps it, and the timestamp round-trips exactly. The
      // metadata equality pins the merged value itself; canonical bytes
      // keep the match independent of JS key-insertion order (jsonb
      // equality is order-insensitive regardless).
      const guarded =
        liveRaw === null
          ? updater.is('metadata', null)
          : updater.eq('metadata', canonicalizeOutboxMetadataForGuard(liveRaw));
      const { data, error } = await (liveUpdatedAt === null
        ? guarded.is('updated_at', null)
        : guarded.eq('updated_at', liveUpdatedAt)
      )
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
      if (
        !error &&
        current?.status === 'processing' &&
        current.locked_by === row.claim_owner &&
        current.dispatch_started_at != null
      ) {
        // The row is intact but moved under the guard: retry the
        // read-merge with the fresh value instead of clobbering it.
        // Bounded like every retry here; exhaustion terminalizes unknown.
        if (attempt >= MANUAL_SENT_METADATA_RACE_RETRIES) {
          throw new OutboxStatusUpdateError(row.id, {
            cause: new Error('metadata changed during sent transition'),
            reason: 'sent_metadata_race_exhausted',
          });
        }
        continue;
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
}
