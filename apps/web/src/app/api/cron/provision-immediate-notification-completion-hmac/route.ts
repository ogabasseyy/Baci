import { type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { hasValidCronSecret } from '@/lib/cron-secret-auth';
import { provisionImmediateNotificationCompletionHmac } from '@/lib/immediate-order/provision-completion-hmac';
import { createImmediateNotificationCompletionHmacServiceClient } from '@/lib/immediate-order/server-completion-hmac-client';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request.headers, getCronSecret())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createImmediateNotificationCompletionHmacServiceClient();
    await provisionImmediateNotificationCompletionHmac(supabase);
    return NextResponse.json({ provisioned: true, success: true });
  } catch (error) {
    logger.error({
      error,
      message: 'Failed to provision notification completion HMAC',
    });
    return NextResponse.json(
      { error: 'Failed to provision completion HMAC' },
      { status: 500 }
    );
  }
}
