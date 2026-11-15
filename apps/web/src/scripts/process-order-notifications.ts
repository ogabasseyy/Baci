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
