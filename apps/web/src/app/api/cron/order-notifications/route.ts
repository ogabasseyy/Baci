import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCronSecret } from '@/env';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/service';
import { createCronBatchSizeSchema } from '@/schemas/cron-batch-size';
import {
  type ClaimedOrderNotificationOutboxRow,
  claimedOrderNotificationOutboxRowSchema,
  createOrderNotificationCronSummary,
  processClaimedOrderNotificationRows,
} from './order-notification-outbox-worker';

export const maxDuration = 60;

// Dead-letters provably unrecoverable MANUAL rows on first observation
// instead of looping on the lease forever: a manual row whose STORED
// identities are unusable can never be delivered by any worker version (no
// tenant scope, no order to fetch), and manual rows re-arm on the next
// order touch if the data is ever repaired. The stored row is re-read by
// id first: a claim projection that transiently drops fields is not proof
// of corruption, and dead-lettering it would silently lose a document.
// Shipping rows are never dead-lettered here:
// they have no re-arm path, so a transient claim-payload bug that drops
// their fields must loop on the lease (and page via the unparseable
// counter) instead of permanently losing the notification. Rows failing
// only on softer fields (lease owner echo, attempt accounting) keep looping
// too — a future version could default those — as do rows with a
// valid-but-unknown event type, which belong to a newer producer. There is
// intentionally no attempt threshold: the stale dispatch terminalizer
// refunds the attempt for leases abandoned before dispatch, so a corrupt
// row's counter oscillates and any threshold is unreachable.
const knownOutboxEventTypes =
  claimedOrderNotificationOutboxRowSchema.shape.event_type;
// Mirrors the worker's manual dispatch condition: the schema conjunct keeps
// the literals from drifting (a renamed event fails closed into the
// lease-loop plus unparseable alert instead of dead-lettering wrongly).
function isManualOutboxEventType(value: unknown): boolean {
  return (
    (value === 'manual_order_receipt' || value === 'manual_order_invoice') &&
    knownOutboxEventTypes.safeParse(value).success
  );
}
function hasUsableIdentity(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}
async function deadLetterCorruptOutboxRow(
  supabase: ReturnType<typeof createServiceClient>,
  workerId: string,
  row: unknown
): Promise<boolean> {
  if (typeof row !== 'object' || row === null) return false;
  const raw = row as Record<string, unknown>;
  if (!hasUsableIdentity(raw.id)) return false;
  if (!isManualOutboxEventType(raw.event_type)) return false;
  if (hasUsableIdentity(raw.merchant_id) && hasUsableIdentity(raw.order_id))
    return false;
  try {
    // The claim projection may transiently drop fields during a
    // producer/worker rollout while the stored row is intact: verify the
    // stored identities before terminalizing, or a claim-payload bug
    // silently loses a document no later edit re-arms.
    const { data: stored, error: readError } = await supabase
      .from('order_notification_outbox')
      .select('event_type, merchant_id, order_id')
      .match({ id: raw.id, locked_by: workerId, status: 'processing' })
      .maybeSingle();
    if (
      readError ||
      !stored ||
      !isManualOutboxEventType(stored.event_type) ||
      hasUsableIdentity(stored.merchant_id) ||
      hasUsableIdentity(stored.order_id)
    )
      return false;
    const { data, error } = await supabase
      .from('order_notification_outbox')
      .update({
        dispatch_started_at: null,
        last_error: 'unparseable_outbox_row',
        locked_at: null,
        locked_by: null,
        next_attempt_at: null,
        skip_reason: 'unparseable',
        skipped_at: new Date().toISOString(),
        status: 'skipped',
        updated_at: new Date().toISOString(),
      })
      .match({ id: raw.id, locked_by: workerId, status: 'processing' })
      .select('id')
      .maybeSingle();
    if (error || data?.id !== raw.id) {
      throw error ?? new Error('dead-letter claim was lost');
    }
    logger.error({
      message: 'Dead-lettered unparseable outbox row',
      rowId: raw.id,
    });
    return true;
  } catch (error) {
    logger.error({
      message: 'Failed to dead-letter unparseable outbox row',
      rowId: raw.id,
      error,
    });
    return false;
  }
}

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10;
const batchSizeSchema = createCronBatchSizeSchema({
  defaultSize: DEFAULT_BATCH_SIZE,
  maxSize: MAX_BATCH_SIZE,
});

export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, getCronSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsedBatchSize = batchSizeSchema.safeParse(
    url.searchParams.get('batchSize')
  );
  if (!parsedBatchSize.success) {
    return NextResponse.json({ error: 'Invalid batch size' }, { status: 400 });
  }
  const batchSize = parsedBatchSize.data;
  const supabase = createServiceClient();
  const workerId = `web-cron-${Date.now()}`;
  const { data, error } = await supabase.rpc(
    'claim_order_notification_outbox',
    {
      p_batch_size: batchSize,
      p_worker_id: workerId,
    }
  );

  if (error) {
    logger.error({
      message: 'Failed to claim order notification outbox rows',
      error,
    });
    return NextResponse.json(
      { error: 'Failed to claim order notifications' },
      { status: 500 }
    );
  }

  // Idle polls on some Supabase/PostgREST versions return null rather
  // than []: treat null as an empty batch instead of 500ing every idle tick.
  const claimed = data ?? [];
  if (!Array.isArray(claimed)) {
    logger.error({
      message: 'Invalid claimed order notification outbox payload',
    });
    return NextResponse.json(
      { error: 'Invalid claimed order notification payload' },
      { status: 500 }
    );
  }

  // Parse each claimed row individually: one unknown event type (a newer
  // producer, a future migration) must not fail the whole batch and stall
  // unrelated notifications until lease expiry. Unparseable rows stay
  // locked and return to pending when the lease expires, except corrupt
  // manual rows (see deadLetterCorruptOutboxRow), which terminalize on
  // first sight. claimed counts the DB-claimed batch, and unparseable
  // counts the rows skipped below, so dashboards can alert on lease-held
  // rows the other outcome counters never mention; each skipped row is
  // also logged by id.
  const summary = createOrderNotificationCronSummary(claimed.length);
  const rows: ClaimedOrderNotificationOutboxRow[] = [];
  for (const row of claimed) {
    const parsedRow = claimedOrderNotificationOutboxRowSchema.safeParse(row);
    if (parsedRow.success) {
      rows.push(parsedRow.data);
      continue;
    }
    summary.unparseable += 1;
    if (await deadLetterCorruptOutboxRow(supabase, workerId, row)) {
      summary.skipped += 1;
      continue;
    }
    // Warn, not error: a valid-but-unknown future event type stays
    // lease-held across polls, and erroring every poll would spam the
    // dashboard during a normal rollout. Terminal corruption still logs
    // at error inside deadLetterCorruptOutboxRow.
    logger.warn({
      message: 'Skipping unparseable claimed outbox row',
      rowId:
        typeof row === 'object' && row !== null && 'id' in row
          ? String((row as { id: unknown }).id)
          : undefined,
      error: z.flattenError(parsedRow.error),
    });
  }
  try {
    await processClaimedOrderNotificationRows(supabase, rows, summary);
  } catch (error) {
    logger.error({
      message: 'Failed to persist order notification outcome',
      error,
    });
    return NextResponse.json(
      { error: 'Failed to persist order notification outcome' },
      { status: 500 }
    );
  }
  return NextResponse.json(summary);
}
