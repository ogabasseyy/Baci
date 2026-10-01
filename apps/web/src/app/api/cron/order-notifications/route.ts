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

// Dead-letters structurally corrupt claimed rows after max_attempts
// observations instead of looping on the lease forever. Only rows with a
// valid-but-unknown event type keep looping: they belong to a newer producer
// and a worker that understands them may still deploy. Every other field the
// row schema requires (identity, lease owner, attempt accounting) is
// permanently required — metadata already accepts unknown shapes — so a row
// that fails parsing with a known (or missing) event type can never be
// delivered by any worker version. The known set is read off the worker
// schema so the two cannot drift.
const knownOutboxEventTypes =
  claimedOrderNotificationOutboxRowSchema.shape.event_type;
async function deadLetterCorruptOutboxRow(
  supabase: ReturnType<typeof createServiceClient>,
  workerId: string,
  row: unknown
): Promise<boolean> {
  if (typeof row !== 'object' || row === null) return false;
  const raw = row as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return false;
  if (
    typeof raw.event_type === 'string' &&
    raw.event_type.length > 0 &&
    !knownOutboxEventTypes.safeParse(raw.event_type).success
  )
    return false;
  const attempts = raw.attempt_count;
  const maxAttempts = raw.max_attempts;
  if (
    typeof attempts !== 'number' ||
    typeof maxAttempts !== 'number' ||
    !Number.isFinite(attempts) ||
    !Number.isFinite(maxAttempts) ||
    attempts < maxAttempts
  ) {
    return false;
  }
  try {
    const { data, error } = await supabase
      .from('order_notification_outbox')
      .update({
        last_error: 'unparseable_outbox_row',
        locked_at: null,
        locked_by: null,
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

  if (!Array.isArray(data)) {
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
  // locked and return to pending when the lease expires, except corrupt rows
  // that exhaust max_attempts (see deadLetterCorruptOutboxRow).
  // claimed counts the DB-claimed batch, and unparseable counts the rows
  // skipped below, so dashboards can alert on lease-held rows the other
  // outcome counters never mention; each skipped row is also logged by id.
  const summary = createOrderNotificationCronSummary(data.length);
  const rows: ClaimedOrderNotificationOutboxRow[] = [];
  for (const row of data) {
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
    logger.error({
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
