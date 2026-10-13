import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { adminNotificationDetailRpcSchema } from '@/schemas/notifications';

export async function getAdminNotificationDetail(id: string) {
  try {
    const supabase = await createClient();
    const rpcClient = supabase as unknown as {
      rpc: (
        fn: 'get_admin_notification_detail',
        args: { p_notification_id: string }
      ) => Promise<{
        data: unknown;
        error: { code?: string; message: string } | null;
      }>;
    };
    const { data, error } = await rpcClient.rpc(
      'get_admin_notification_detail',
      {
        p_notification_id: id,
      }
    );
    if (error?.code === '42501') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }
    if (error) {
      logger.error({
        message: 'Error fetching notification detail',
        error,
        id,
      });
      return NextResponse.json(
        { error: 'Failed to fetch notification' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }
    const parsed = adminNotificationDetailRpcSchema.safeParse(data);
    if (!parsed.success) {
      logger.error({ message: 'Invalid notification detail payload', id });
      return NextResponse.json(
        { error: 'Failed to fetch notification' },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ...parsed.data.notification,
      stats: parsed.data.stats,
      deliveries: parsed.data.deliveries,
    });
  } catch (error) {
    logger.error({ message: 'Admin notification GET error', error });
    return NextResponse.json(
      { error: 'Failed to fetch notification' },
      { status: 500 }
    );
  }
}
