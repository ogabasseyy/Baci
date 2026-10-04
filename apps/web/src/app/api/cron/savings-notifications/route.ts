import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { logger } from '@/lib/logger';
import { runSavingsNotificationPushWorker } from '@/lib/savings-notifications/push-worker-runtime';
import { savingsNotificationWorkerLimitSchema } from '@/schemas/savings-notification-worker';

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limit = savingsNotificationWorkerLimitSchema.safeParse(
    new URL(request.url).searchParams.get('batchSize') ?? undefined
  );
  if (!limit.success) {
    return NextResponse.json({ error: 'Invalid batch size' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await runSavingsNotificationPushWorker({ limit: limit.data })
    );
  } catch {
    logger.error({ message: 'Savings notification push worker failed' });
    return NextResponse.json(
      { error: 'Savings notification push worker failed' },
      { status: 500 }
    );
  }
}
