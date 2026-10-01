import { type NextRequest, NextResponse } from 'next/server';
import { checkCsrfProtection } from '@/lib/csrf';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';
import { createClient } from '@/lib/supabase/server';
import { adminPushTestSchema } from '@/schemas/push-test';
import { deliverAdminPushTest } from './admin-push-test-delivery';

export async function POST(request: NextRequest) {
  const auth = await getPlatformAdminAuthForPermission('notifications.manage');
  if (auth.status === 'unauthenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (auth.status !== 'authenticated') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { valid: csrfValid, response: csrfResponse } =
    await checkCsrfProtection(request);
  if (!csrfValid) {
    return (
      csrfResponse ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = adminPushTestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data' },
      { status: 400 }
    );
  }

  let result: Awaited<ReturnType<typeof deliverAdminPushTest>>;
  try {
    const supabase = await createClient();
    result = await deliverAdminPushTest(
      supabase,
      auth.user.id,
      parsed.data.title,
      parsed.data.body
    );
  } catch {
    console.error('Admin push test delivery failed');
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 }
    );
  }

  const status =
    result.sent > 0 && result.failed > 0
      ? 'partial_failure'
      : result.sent > 0
        ? 'sent'
        : result.failed > 0
          ? 'failed'
          : 'skipped_no_tokens';

  return NextResponse.json({
    status,
    sent: result.sent,
    failed: result.failed,
  });
}
