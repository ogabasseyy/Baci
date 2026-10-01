import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

export async function deleteAdminNotification(id: string) {
  try {
    const supabase = await createClient();
    const { data: existing, error: fetchError } = await supabase
      .from('notifications')
      .select('id, sent_at, delivery_state, delivery_attempts')
      .eq('id', id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }
    if (
      existing.sent_at ||
      existing.delivery_state !== 'pending' ||
      existing.delivery_attempts > 0
    ) {
      return NextResponse.json(
        {
          error:
            'Only pending notifications can be cancelled; delivery history is retained',
        },
        { status: 409 }
      );
    }

    const { data: deleted, error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('delivery_state', 'pending')
      .eq('delivery_attempts', 0)
      .is('sent_at', null)
      .select('id')
      .maybeSingle();
    if (error) {
      logger.error({ message: 'Error deleting notification', error, id });
      return NextResponse.json(
        { error: 'Failed to delete notification' },
        { status: 500 }
      );
    }
    if (!deleted) {
      return NextResponse.json(
        { error: 'Notification delivery has already started' },
        { status: 409 }
      );
    }
    return NextResponse.json({
      success: true,
      message: 'Pending notification cancelled',
    });
  } catch (error) {
    logger.error({ message: 'Admin notification DELETE error', error });
    return NextResponse.json(
      { error: 'Failed to delete notification' },
      { status: 500 }
    );
  }
}
