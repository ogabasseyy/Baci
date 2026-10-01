import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import {
  adminNotificationDashboardRpcSchema,
  adminNotificationListQuerySchema,
} from '@/schemas/notifications';
import type {
  Notification,
  NotificationWithStats,
} from '@/types/notifications';

type ListQuery = ReturnType<typeof adminNotificationListQuerySchema.parse>;
type NotificationStats = NotificationWithStats['stats'];

const defaultStats: NotificationStats = {
  total_sent: 0,
  total_push_sent: 0,
  total_read: 0,
  total_dismissed: 0,
  read_rate: 0,
};

export async function listAdminNotifications(url: string) {
  const parsedQuery = parseListQuery(url);
  if (parsedQuery instanceof NextResponse) return parsedQuery;

  try {
    const supabase = await createClient();
    const { status, type, priority, search, limit, offset } = parsedQuery;
    let query = supabase
      .from('notifications')
      .select(
        'id, template_id, title, message, notification_type, priority, target_type, target_segment, channels, action_url, action_label, scheduled_for, expires_at, created_by, created_at, delivery_state, delivery_attempts, sent_at, is_system',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    const now = new Date().toISOString();
    if (status === 'sent') query = query.eq('delivery_state', 'sent');
    else if (status === 'scheduled') {
      query = query.eq('delivery_state', 'pending').gt('scheduled_for', now);
    } else if (status === 'queued') {
      query = query.eq('delivery_state', 'pending').lte('scheduled_for', now);
    } else if (status !== 'all') {
      query = query.eq('delivery_state', status);
    }
    if (type) query = query.eq('notification_type', type);
    if (priority) query = query.eq('priority', priority);
    if (search) {
      const sanitizedSearch = quotePostgrestOrValue(search);
      query = query.or(
        `title.ilike.*${sanitizedSearch}*,message.ilike.*${sanitizedSearch}*`
      );
    }

    const {
      data: notifications,
      error,
      count,
    } = await query.range(offset, offset + limit - 1);
    if (error) {
      logger.error({ message: 'Error fetching notifications', error });
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 }
      );
    }

    const notificationsWithStats = await addListStats(supabase, notifications);
    if (notificationsWithStats instanceof NextResponse) {
      return notificationsWithStats;
    }
    const dashboard = await getDashboard(supabase, parsedQuery);
    if (dashboard instanceof NextResponse) return dashboard;

    return NextResponse.json({
      data: notificationsWithStats,
      dashboard,
      pagination: {
        total: count || 0,
        limit,
        offset,
        has_more: (count || 0) > offset + limit,
      },
    });
  } catch (error) {
    logger.error({ message: 'Admin notifications GET internal error', error });
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

/** Quote OR-filter values so commas, parentheses and quotes stay data. */
function quotePostgrestOrValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function parseListQuery(url: string): ListQuery | NextResponse {
  const { searchParams } = new URL(url);
  const parsed = adminNotificationListQuerySchema.safeParse({
    status: searchParams.get('status') ?? undefined,
    type: searchParams.get('type') ?? undefined,
    priority: searchParams.get('priority') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
  });
  if (parsed.success) return parsed.data;
  return NextResponse.json(
    {
      error: 'Invalid notification query',
      details: z.flattenError(parsed.error),
    },
    { status: 400 }
  );
}

async function addListStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  notifications:
    | Omit<Notification, 'delivery_last_error' | 'target_merchant_ids'>[]
    | null
): Promise<NotificationWithStats[] | NextResponse> {
  const notificationIds = (notifications ?? []).map(({ id }) => id);
  let stats = new Map<string, NotificationStats>();
  if (notificationIds.length > 0) {
    const { data, error } = await supabase.rpc(
      'get_admin_notification_stats_batch',
      { p_notification_ids: notificationIds }
    );
    if (error) {
      logger.error({
        message: 'Error fetching admin notification delivery statistics',
        error,
      });
      return NextResponse.json(
        { error: 'Failed to fetch notification delivery statistics' },
        { status: error.code === '42501' ? 403 : 500 }
      );
    }
    if (data && Array.isArray(data)) {
      stats = new Map(data.map((value) => [value.notification_id, value]));
      if (
        notificationIds.some((notificationId) => !stats.has(notificationId))
      ) {
        logger.error({
          message: 'Incomplete admin notification delivery statistics payload',
        });
        return NextResponse.json(
          { error: 'Failed to fetch notification delivery statistics' },
          { status: 500 }
        );
      }
    } else {
      logger.error({
        message: 'Invalid admin notification delivery statistics payload',
      });
      return NextResponse.json(
        { error: 'Failed to fetch notification delivery statistics' },
        { status: 500 }
      );
    }
  }
  return (notifications ?? []).map((notification) => ({
    ...notification,
    // Target identifiers are sensitive merchant-directory data. The list is
    // intentionally useful without them; privileged detail is a separate RPC.
    target_merchant_ids: [],
    // The list endpoint deliberately never returns raw worker/provider errors.
    // The detail RPC returns a bounded, control-character-sanitized summary.
    delivery_last_error: null,
    stats: stats.get(notification.id) ?? defaultStats,
  }));
}

async function getDashboard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: ListQuery
) {
  const rpcClient = supabase as unknown as {
    rpc: (
      fn: 'get_admin_notification_dashboard',
      args: {
        p_status: string;
        p_type: string | null;
        p_priority: string | null;
        p_search: string | null;
      }
    ) => Promise<{
      data: unknown;
      error: { code?: string; message: string } | null;
    }>;
  };
  const { data, error } = await rpcClient.rpc(
    'get_admin_notification_dashboard',
    {
      p_status: query.status,
      p_type: query.type ?? null,
      p_priority: query.priority ?? null,
      p_search: query.search ?? null,
    }
  );
  if (error) {
    logger.error({
      message: 'Error fetching notification dashboard totals',
      error,
    });
    return NextResponse.json(
      { error: 'Failed to fetch notification totals' },
      { status: error.code === '42501' ? 403 : 500 }
    );
  }
  const parsed = adminNotificationDashboardRpcSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  logger.error({ message: 'Invalid notification dashboard totals payload' });
  return NextResponse.json(
    { error: 'Failed to fetch notification totals' },
    { status: 500 }
  );
}
