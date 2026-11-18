import 'dotenv/config';
import crypto from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  type ClaimedOrderNotificationOutboxRow,
  claimedOrderNotificationOutboxRowSchema,
  createOrderNotificationCronSummary,
  processClaimedOrderNotificationRows,
} from '@/app/api/cron/order-notifications/order-notification-outbox-worker';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/service';

const DEFAULT_BATCH_SIZE = 5;
const knownOutboxEventTypes =
  claimedOrderNotificationOutboxRowSchema.shape.event_type;

function isManualOutboxEventType(value: unknown): boolean {
  return (
    (value === 'manual_order_receipt' || value === 'manual_order_invoice') &&
    knownOutboxEventTypes.safeParse(value).success
  );
}

function hasUsableIdentity(value: unknown): value is string {
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
  if (hasUsableIdentity(raw.merchant_id) && hasUsableIdentity(raw.order_id)) {
    return false;
  }
  try {
    const { data, error } = await supabase.rpc(
      'dead_letter_corrupt_outbox_row',
      { p_outbox_id: raw.id, p_worker_id: workerId }
    );
    if (error || data !== true) {
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
const MAX_BATCH_SIZE = 10;

function parseBatchSize(argv: string[]): number {
  const flag = argv.find((arg) => arg.startsWith('--batch-size='));
  if (!flag) return DEFAULT_BATCH_SIZE;
  const parsed = Number(flag.slice('--batch-size='.length));
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_BATCH_SIZE) {
    throw new Error(`Invalid --batch-size value: ${flag}`);
  }
  return parsed;
}

export async function runOrderNotificationsCli(
  batchSize = parseBatchSize(process.argv.slice(2))
): Promise<number> {
  const supabase = createServiceClient();
  const workerId = `vps-cron-${Date.now()}-${crypto.randomUUID()}`;
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
    return 1;
  }

  const claimed = data ?? [];
  if (!Array.isArray(claimed)) {
    logger.error({
      message: 'Invalid claimed order notification outbox payload',
    });
    return 1;
  }

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
    logger.warn({
      message: 'Skipping unparseable claimed outbox row',
      rowId:
        typeof row === 'object' && row !== null && 'id' in row
          ? String((row as { id: unknown }).id)
          : undefined,
      error: z.flattenError(parsedRow.error),
    });
  }

  await processClaimedOrderNotificationRows(supabase, rows, summary);
  console.log(JSON.stringify(summary));
  return 0;
}

const currentFile = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;

if (import.meta.url === currentFile) {
  runOrderNotificationsCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error
      );
      process.exitCode = 1;
    });
}
