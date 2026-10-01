import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { merchantNotificationListResultSchema } from '@/schemas/merchant-notification-list-result';
import { merchantNotificationListQuerySchema } from '@/schemas/notifications';

/**
 * GET /api/notifications
 * Fetch the current merchant's notifications with cursor-based pagination
 *
 * Query params:
 * - cursor: ISO timestamp string for cursor-based pagination
 * - limit: number (default 20, max 50)
 * - unread_only: boolean
 * - type: NotificationType
 */
export async function GET(request: NextRequest) {
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

    // Validate only the supported query parameters before they reach PostgREST.
    const { searchParams } = new URL(request.url);
    const queryParams = merchantNotificationListQuerySchema.safeParse({
      cursor: searchParams.get('cursor') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      unread_only: searchParams.get('unread_only') ?? undefined,
      type: searchParams.get('type') ?? undefined,
    });
    if (!queryParams.success) {
      return NextResponse.json(
        { error: 'Invalid notification query' },
        { status: 400 }
      );
    }
    const { cursor, limit, unread_only: unreadOnly, type } = queryParams.data;
    const now = new Date().toISOString();
    const unexpiredNotificationFilter = `expires_at.is.null,expires_at.gt.${now}`;

    // Build query with notification join
    let query = supabase
      .from('merchant_notifications')
      .select(`
        id,
        notification_id,
        merchant_id,
        read_at,
        dismissed_at,
        banner_dismissed_at,
        in_app_visible,
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
          is_system
        )
      `)
      .eq('merchant_id', merchantId)
      .eq('in_app_visible', true)
      .is('dismissed_at', null)
      .eq('notification.delivery_state', 'sent')
      .or(unexpiredNotificationFilter, { referencedTable: 'notification' })
      .order('created_at', { ascending: false });

    // Cursor-based pagination (older than cursor)
    if (cursor) {
      query = query.lt('created_at', cursor);
    }

    // Unread filter
    if (unreadOnly) {
      query = query.is('read_at', null);
    }

    // PERFORMANCE: Move type filter to database query
    if (type) {
      query = query.eq('notification.notification_type', type);
    }

    // Limit + 1 to check if there are more
    query = query.limit(limit + 1);

    const { data: notifications, error } = await query;

    if (error) {
      console.error('Failed to fetch notifications', {
        errorCode: error.code || 'unknown',
      });
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        {
          status: 500,
        }
      );
    }

    const parsedNotifications = merchantNotificationListResultSchema.safeParse(
      notifications ?? []
    );
    if (!parsedNotifications.success) {
      console.error('Failed to fetch notifications', {
        errorCode: 'invalid_notification_result',
      });
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 }
      );
    }
    let visibleNotifications = parsedNotifications.data;

    // Check if there are more results
    const hasMore = visibleNotifications.length > limit;
    if (hasMore) {
      visibleNotifications = visibleNotifications.slice(0, limit);
    }

    // Get cursor for next page
    const nextCursor =
      hasMore && visibleNotifications.length > 0
        ? visibleNotifications[visibleNotifications.length - 1].created_at
        : null;

    // Get unread count
    const { count: unreadCount, error: countError } = await supabase
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

    if (countError) {
      console.error('Failed to count unread notifications', {
        errorCode: countError.code || 'unknown',
      });
      return NextResponse.json(
        { error: 'Failed to fetch notification count' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: visibleNotifications,
      cursor: nextCursor,
      has_more: hasMore,
      unread_count: unreadCount ?? 0,
    });
  } catch {
    console.error('Unexpected failure fetching notifications');
    return NextResponse.json(
      { error: 'Critical failure fetching notifications' },
      { status: 500 }
    );
  }
}
