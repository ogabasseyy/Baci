import { NextResponse } from 'next/server';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import {
  adminHealthCheckSchema,
  adminSystemHealthSchema,
} from '@/schemas/admin-system-health';

export async function GET() {
  const auth = await getPlatformAdminAuthForPermission('operations.read');
  if (auth.status !== 'authenticated') {
    return NextResponse.json(
      {
        error: auth.status === 'unauthenticated' ? 'Unauthorized' : 'Forbidden',
      },
      { status: auth.status === 'unauthenticated' ? 401 : 403 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_admin_system_health_v1');

  if (error) {
    console.error('[Admin system health] RPC failed', {
      code: error.code,
    });
    return NextResponse.json(
      { error: 'Failed to check database health' },
      { status: 500 }
    );
  }

  const parsed = adminSystemHealthSchema.safeParse(data);
  if (!parsed.success) {
    console.error('[Admin system health] Invalid RPC response');
    return NextResponse.json(
      { error: 'Invalid database health response' },
      { status: 500 }
    );
  }

  const { data: notificationWorker, error: notificationWorkerError } =
    await supabase.rpc('get_scheduled_notification_worker_health_v1');
  const workerCheck = adminHealthCheckSchema.safeParse(notificationWorker);
  if (notificationWorkerError) {
    console.error('[Admin system health] Notification worker probe failed', {
      code: notificationWorkerError.code,
    });
  } else if (!workerCheck.success) {
    console.error(
      '[Admin system health] Notification worker probe returned invalid response'
    );
  }
  const health =
    workerCheck.success && !notificationWorkerError
      ? [...parsed.data.health, workerCheck.data]
      : [
          ...parsed.data.health,
          {
            check_name: 'Scheduled notification worker',
            details: { probe: 'worker_health_unavailable' },
            message:
              'Scheduled notification worker health could not be verified.',
            status: 'critical' as const,
          },
        ];
  return NextResponse.json(
    { ...parsed.data, health },
    {
      headers: { 'Cache-Control': 'private, no-store' },
    }
  );
}
