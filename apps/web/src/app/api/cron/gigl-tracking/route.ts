import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { createGiglTrackingWorkerClient } from '@/lib/gigl-tracking-worker-client';
import { logger } from '@/lib/logger';
import { isGiglRuntimeConfigured } from '@/lib/shipping/providers/gigl.constants';
import { createCronBatchSizeSchema } from '@/schemas/cron-batch-size';
import { runGiglTrackingMonitorBatch } from './run-gigl-tracking-monitor-batch';

export const maxDuration = 60;

const batchSizeSchema = createCronBatchSizeSchema({
  defaultSize: 25,
  maxSize: 50,
});

export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedBatchSize = batchSizeSchema.safeParse(
    new URL(request.url).searchParams.get('batchSize')
  );
  if (!parsedBatchSize.success) {
    return NextResponse.json({ error: 'Invalid batch size' }, { status: 400 });
  }

  if (!isGiglRuntimeConfigured()) {
    return NextResponse.json({
      applied: 0,
      claimed: 0,
      failed: 0,
      paused: 0,
      success: true,
    });
  }

  let supabase: ReturnType<typeof createGiglTrackingWorkerClient>;
  try {
    supabase = createGiglTrackingWorkerClient(process.env);
  } catch {
    logger.error({ message: 'Invalid GIGL tracking worker token' });
    return NextResponse.json(
      { error: 'GIGL tracking worker unavailable' },
      { status: 500 }
    );
  }
  const workerId = `gigl-tracking-${crypto.randomUUID()}`;
  const result = await runGiglTrackingMonitorBatch({
    batchSize: parsedBatchSize.data,
    client: supabase,
    workerId,
  });
  if (!result.ok && result.reason === 'claim_failed') {
    logger.error({ message: 'Failed to claim GIGL tracking monitors' });
    return NextResponse.json(
      { error: 'Failed to claim GIGL tracking monitors' },
      { status: 500 }
    );
  }
  if (!result.ok && result.reason === 'invalid_claim_payload') {
    logger.error({
      message: 'Invalid GIGL tracking monitor claim payload',
    });
    return NextResponse.json(
      { error: 'Invalid GIGL tracking monitor payload' },
      { status: 500 }
    );
  }
  if (!result.ok) {
    logger.error({ message: 'GIGL tracking worker failed' });
    return NextResponse.json(
      { error: 'Failed to process GIGL tracking monitors' },
      { status: 500 }
    );
  }

  return NextResponse.json(result.summary);
}
