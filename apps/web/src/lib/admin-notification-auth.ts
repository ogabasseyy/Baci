import { NextResponse } from 'next/server';
import { getPlatformAdminAuthForPermission } from '@/lib/platform-admin-auth';

export type NotificationAdminAuthResult =
  | { response: NextResponse; status: 'error' }
  | { status: 'authorized'; userId: string };

/** Permission boundary shared by every platform notification endpoint. */
export async function authorizeNotificationAdmin(): Promise<NotificationAdminAuthResult> {
  const auth = await getPlatformAdminAuthForPermission('notifications.manage');
  if (auth.status === 'unauthenticated') {
    return {
      status: 'error',
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (auth.status !== 'authenticated') {
    return {
      status: 'error',
      response: NextResponse.json(
        { error: 'Forbidden - notification management access required' },
        { status: 403 }
      ),
    };
  }
  return { status: 'authorized', userId: auth.user.id };
}
