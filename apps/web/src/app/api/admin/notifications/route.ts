import { type NextRequest, NextResponse } from 'next/server';
import { authorizeNotificationAdmin } from '@/lib/admin-notification-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createAdminNotification } from './notification-create-handler';
import { listAdminNotifications } from './notification-list-handler';

export async function GET(request: NextRequest) {
  const authorization = await authorizeNotificationAdmin();
  if (authorization.status === 'error') return authorization.response;
  return listAdminNotifications(request.url);
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeNotificationAdmin();
  if (authorization.status === 'error') return authorization.response;

  const { valid, response } = await checkCsrfProtection(request);
  if (!valid) {
    return (
      response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }
  return createAdminNotification(request, authorization.userId);
}
