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
  // locked and return to pending when the lease expires.
  const rows: ClaimedOrderNotificationOutboxRow[] = [];
  for (const row of data) {
    const parsedRow = claimedOrderNotificationOutboxRowSchema.safeParse(row);
    if (parsedRow.success) {
      rows.push(parsedRow.data);
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
  const summary = createOrderNotificationCronSummary(rows.length);
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
