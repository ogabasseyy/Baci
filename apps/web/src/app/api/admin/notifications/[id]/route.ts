import { type NextRequest, NextResponse } from 'next/server';
import { authorizeNotificationAdmin } from '@/lib/admin-notification-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { notificationIdSchema } from '@/schemas/notifications';
import { deleteAdminNotification } from './notification-delete-handler';
import { getAdminNotificationDetail } from './notification-detail-handler';
import { updateAdminNotification } from './notification-update-handler';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const authorization = await authorizeNotificationAdmin();
  if (authorization.status === 'error') return authorization.response;
  const id = await validateNotificationId(params);
  if (id instanceof NextResponse) return id;
  return getAdminNotificationDetail(id);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authorization = await authorizeNotificationAdmin();
  if (authorization.status === 'error') return authorization.response;
  const csrfResponse = await requireCsrf(request);
  if (csrfResponse) return csrfResponse;
  const id = await validateNotificationId(params);
  if (id instanceof NextResponse) return id;
  return updateAdminNotification(request, id);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authorization = await authorizeNotificationAdmin();
  if (authorization.status === 'error') return authorization.response;
  const csrfResponse = await requireCsrf(request);
  if (csrfResponse) return csrfResponse;
  const id = await validateNotificationId(params);
  if (id instanceof NextResponse) return id;
  return deleteAdminNotification(id);
}

async function validateNotificationId(params: RouteParams['params']) {
  const { id } = await params;
  if (notificationIdSchema.safeParse(id).success) return id;
  return NextResponse.json(
    { error: 'Invalid notification ID format' },
    { status: 400 }
  );
}

async function requireCsrf(request: NextRequest) {
  const { valid, response } = await checkCsrfProtection(request);
  if (valid) return null;
  return (
    response ??
    NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  );
}
