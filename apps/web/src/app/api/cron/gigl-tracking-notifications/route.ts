import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { logger } from '@/lib/logger';
import { createServiceClient } from '@/lib/supabase/service';
import { createCronBatchSizeSchema } from '@/schemas/cron-batch-size';
import { runGiglTrackingNotificationBatch } from './run-gigl-tracking-notification-batch';

export const maxDuration = 60;
const MAX_NOTIFICATION_BATCH_SIZE = 10;
const batchSizeSchema = createCronBatchSizeSchema({
  defaultSize: MAX_NOTIFICATION_BATCH_SIZE,
  maxSize: MAX_NOTIFICATION_BATCH_SIZE,
});

export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const batchSize = batchSizeSchema.safeParse(
    new URL(request.url).searchParams.get('batchSize')
  );
  if (!batchSize.success)
    return NextResponse.json({ error: 'Invalid batch size' }, { status: 400 });

  const supabase = createServiceClient('event-pipeline');
  const workerId = `gigl-notifications-${crypto.randomUUID()}`;
  const result = await runGiglTrackingNotificationBatch({
    batchSize: batchSize.data,
    client: supabase,
    workerId,
  });
  if (!result.ok && result.reason === 'claim_failed') {
    logger.error({
      message: 'Failed to claim GIGL tracking notifications',
    });
    return NextResponse.json(
      { error: 'Failed to claim GIGL tracking notifications' },
      { status: 500 }
    );
  }
  if (!result.ok && result.reason === 'invalid_claim_payload') {
    logger.error({
      message: 'Invalid GIGL tracking notification claim payload',
    });
    return NextResponse.json(
      { error: 'Invalid GIGL tracking notification payload' },
      { status: 500 }
    );
  }
  if (!result.ok) {
    logger.error({
      message: 'GIGL tracking notification worker failed',
    });
    return NextResponse.json(
      { error: 'Failed to process GIGL tracking notifications' },
      { status: 500 }
    );
  }

  return NextResponse.json(result.summary);
}
