import { NextResponse } from 'next/server';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { createImmediateNotificationRedriveClient } from '@/lib/immediate-order/notification-redrive-client';
import { recoverImmediateNotifications } from '@/lib/immediate-order/notification-redrive-worker';
import { logger } from '@/lib/logger';
import { immediateNotificationRecoveryBatchQuery } from '@/schemas/immediate-notification-redrive';

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasValidCronSecret(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.IMMEDIATE_NOTIFICATION_REDRIVE_ENABLED !== 'true') {
    return new NextResponse(null, { status: 204 });
  }
  const parsed = immediateNotificationRecoveryBatchQuery.safeParse(
    new URL(request.url).searchParams.get('batchSize') ?? '25'
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid batch size' }, { status: 400 });
  }
  try {
    const client = createImmediateNotificationRedriveClient(process.env);
    const result = await recoverImmediateNotifications(client, parsed.data);
    if (result.unresolved || result.hasReconciliationBacklog) {
      logger.warn({
        message: 'Immediate notification deliveries require reconciliation',
        unresolved: result.unresolved,
        hasReconciliationBacklog: result.hasReconciliationBacklog,
      });
    }
    return NextResponse.json(result);
  } catch {
    logger.error({ message: 'Immediate notification recovery failed' });
    return NextResponse.json(
      { error: 'Immediate notification recovery failed' },
      { status: 500 }
    );
  }
}
