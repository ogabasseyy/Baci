import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { createNotificationSchema } from '@/schemas/notifications';

export async function createAdminNotification(
  request: Request,
  userId: string
) {
  try {
    const body = await parseRequestBody(request);
    if (body instanceof NextResponse) return body;
    const parsed = createNotificationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const requestedScheduledFor = data.scheduled_for
      ? new Date(data.scheduled_for)
      : null;
    const now = new Date();
    const isImmediate = !requestedScheduledFor || requestedScheduledFor <= now;
    const scheduledFor = isImmediate
      ? now.toISOString()
      : (data.scheduled_for ?? now.toISOString());
    if (
      data.expires_at &&
      new Date(data.expires_at).getTime() <= new Date(scheduledFor).getTime()
    ) {
      return NextResponse.json(
        { error: 'Expiration must be after the effective send time' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    if (data.target_type === 'specific' && data.target_merchant_ids?.length) {
      const targetsClient = supabase as unknown as {
        rpc: (
          name: 'resolve_admin_notification_target_merchant_ids_v1',
          args: { p_merchant_ids: string[] }
        ) => Promise<{ data: string[] | null; error: unknown }>;
      };
      const { data: targetRows, error } = await targetsClient.rpc(
        'resolve_admin_notification_target_merchant_ids_v1',
        { p_merchant_ids: data.target_merchant_ids }
      );
      if (
        error ||
        (targetRows?.length ?? 0) !== data.target_merchant_ids.length
      ) {
        return NextResponse.json(
          { error: 'One or more target merchants do not exist' },
          { status: 400 }
        );
      }
    }

    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        title: data.title,
        message: data.message,
        notification_type: data.notification_type,
        priority: data.priority,
        target_type: data.target_type,
        target_merchant_ids: data.target_merchant_ids || [],
        target_segment: data.target_segment || null,
        channels: data.channels,
        action_url: data.action_url ?? null,
        action_label: data.action_label ?? null,
        scheduled_for: scheduledFor,
        expires_at: data.expires_at ?? null,
        template_id: data.template_id ?? null,
        created_by: userId,
      })
      .select(
        'id, template_id, title, message, notification_type, priority, target_type, target_segment, channels, action_url, action_label, scheduled_for, expires_at, created_by, created_at, delivery_state, delivery_attempts, sent_at, is_system'
      )
      .single();
    if (error) {
      logger.error({ message: 'Error creating notification', error });
      return NextResponse.json(
        { error: 'Failed to create notification' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        notification: { ...notification, target_merchant_ids: [] },
        status: isImmediate ? 'queued' : 'scheduled',
        scheduled_for: notification.scheduled_for,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ message: 'Admin notifications POST internal error', error });
    return NextResponse.json(
      { error: 'Failed to create notification' },
      { status: 500 }
    );
  }
}

async function parseRequestBody(
  request: Request
): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
