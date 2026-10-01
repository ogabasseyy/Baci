import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { merchantNotificationWithDetailsSchema } from '@/schemas/merchant-notification-list-result';
import {
  notificationIdSchema,
  updateMerchantNotificationSchema,
} from '@/schemas/notifications';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/notifications/[id]
 * Get a specific notification for the current merchant
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Authentication check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant (supports both owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;
    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'dashboard', 'view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id: rawId } = await params;
    const id = notificationIdSchema.safeParse(rawId);
    if (!id.success) {
      return NextResponse.json(
        { error: 'Invalid notification ID' },
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    const unexpiredNotificationFilter = `expires_at.is.null,expires_at.gt.${now}`;

    // An individual recipient record has the same parent visibility rules as
    // the notification list. Do not reveal or mutate a pending/sent-expired
    // parent merely because a caller knows its recipient row ID.
    const { data: notification, error } = await supabase
      .from('merchant_notifications')
      .select(`
        id,
        notification_id,
        merchant_id,
        read_at,
        dismissed_at,
        banner_dismissed_at,
        created_at,
        notification:notifications!inner (
          id,
          title,
          message,
          notification_type,
          priority,
          channels,
          action_url,
          action_label,
          expires_at,
          created_at,
          is_system,
          delivery_state,
          sent_at
        )
      `)
      .eq('id', id.data)
      .eq('merchant_id', merchantId)
      .eq('notification.delivery_state', 'sent')
      .or(unexpiredNotificationFilter, { referencedTable: 'notification' })
      .single();

    if (error || !notification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    const parsedNotification =
      merchantNotificationWithDetailsSchema.safeParse(notification);
    if (!parsedNotification.success) {
      console.error('Failed to fetch notification', {
        errorCode: 'invalid_notification_result',
      });
      return NextResponse.json(
        { error: 'Failed to fetch notification' },
        { status: 500 }
      );
    }

    return NextResponse.json(parsedNotification.data);
  } catch {
    console.error('Unexpected failure fetching notification');
    return NextResponse.json(
      { error: 'Failed to fetch notification' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/notifications/[id]
 * Update notification status (mark as read, dismiss, etc.)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Authentication is deliberately the first protected operation. In
    // particular, unauthenticated callers must not receive a CSRF verdict.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant (supports both owners and staff)
    const merchantContext = await getMerchantForApiRequest(supabase, user.id);
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }
    const merchantId = merchantContext.merchantId;
    const patchAccess = toUserAccess(merchantContext);
    if (!hasPermission(patchAccess, 'dashboard', 'view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return (
        csrfResponse ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const { id: rawId } = await params;
    const id = notificationIdSchema.safeParse(rawId);
    if (!id.success) {
      return NextResponse.json(
        { error: 'Invalid notification ID' },
        { status: 400 }
      );
    }

    const json: unknown = await request.json().catch(() => null);
    if (json === null) {
      return NextResponse.json(
        { error: 'Invalid notification update' },
        { status: 400 }
      );
    }
    const body = updateMerchantNotificationSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json(
        { error: 'Invalid notification update' },
        { status: 400 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {};

    if (body.data.read === true) {
      updates.read_at = new Date().toISOString();
    } else if (body.data.read === false) {
      updates.read_at = null;
    }

    if (body.data.dismissed === true) {
      updates.dismissed_at = new Date().toISOString();
    }

    if (body.data.banner_dismissed === true) {
      updates.banner_dismissed_at = new Date().toISOString();
    }

    const now = new Date().toISOString();
    const unexpiredNotificationFilter = `expires_at.is.null,expires_at.gt.${now}`;

    // Update filters cannot safely express a parent-table join. First prove
    // that the recipient row is currently visible, final, and unexpired; RLS
    // repeats this parent check at write time to close the expiry race.
    const { data: recipient, error: recipientError } = await supabase
      .from('merchant_notifications')
      .select('id, notification:notifications!inner(id)')
      .eq('id', id.data)
      .eq('merchant_id', merchantId)
      .eq('notification.delivery_state', 'sent')
      .or(unexpiredNotificationFilter, { referencedTable: 'notification' })
      .maybeSingle();

    if (recipientError) {
      console.error('Failed to validate notification recipient', {
        errorCode: recipientError.code || 'unknown',
      });
      return NextResponse.json(
        { error: 'Failed to update notification' },
        { status: 500 }
      );
    }
    if (!recipient) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Update notification
    const { data: updated, error: updateError } = await supabase
      .from('merchant_notifications')
      .update(updates)
      .eq('id', id.data)
      .eq('merchant_id', merchantId)
      .select(
        'id, notification_id, merchant_id, read_at, dismissed_at, banner_dismissed_at, created_at'
      )
      .single();

    if (updateError) {
      console.error('Failed to update notification', {
        errorCode: updateError.code || 'unknown',
      });
      return NextResponse.json(
        { error: 'Failed to update notification' },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Keep this exact filter set in sync with GET /api/notifications.
    const { count: unreadCount, error: unreadCountError } = await supabase
      .from('merchant_notifications')
      .select('id, notification:notifications!inner(id)', {
        count: 'exact',
        head: true,
      })
      .eq('merchant_id', merchantId)
      .eq('in_app_visible', true)
      .is('read_at', null)
      .is('dismissed_at', null)
      .eq('notification.delivery_state', 'sent')
      .or(unexpiredNotificationFilter, { referencedTable: 'notification' });

    if (unreadCountError) {
      console.error('Failed to count unread notifications after update', {
        errorCode: unreadCountError.code || 'unknown',
      });
    }

    return NextResponse.json({
      ...updated,
      unread_count: unreadCountError ? null : (unreadCount ?? 0),
    });
  } catch {
    console.error('Unexpected failure updating notification');
    return NextResponse.json(
      { error: 'Failed to update notification' },
      { status: 500 }
    );
  }
}
