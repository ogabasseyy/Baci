import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

type NotificationPreferencesClient = SupabaseClient<Database>;

/**
 * Read the follow-up alert preference for a newly-created invoice.
 *
 * Missing preference rows are treated as enabled so existing merchants keep
 * receiving the new invoice alert. A read failure also fails open: delivery
 * errors should not be hidden behind an optional preference lookup.
 */
export async function isFollowUpNotificationsEnabled(
  supabase: NotificationPreferencesClient,
  orderId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'get_follow_up_notification_preference',
    { p_order_id: orderId }
  );

  if (error) {
    console.warn(
      '[notifications] Failed to read follow-up alert preference; keeping alerts enabled',
      error.message
    );
    return true;
  }

  return data ?? true;
}
