import type { SupabaseClient } from '@supabase/supabase-js';
import Expo, { type ExpoPushMessage } from 'expo-server-sdk';
import { sendPushNotificationChunks } from '@/lib/expo-push-chunk-delivery';

export type AdminPushTestDeliveryResult = {
  failed: number;
  sent: number;
  uncertain: number;
};

function readServerExpoAccessToken(): string | undefined {
  return process.env.EXPO_ACCESS_TOKEN || undefined;
}

/**
 * Sends only to the current user's RLS-visible admin devices. This intentionally
 * does not use the generic delivery pipeline, which needs service-role access to
 * record tickets and deactivate tokens for unrelated caller types.
 */
export async function deliverAdminPushTest(
  supabase: SupabaseClient,
  userId: string,
  title: string,
  body: string
): Promise<AdminPushTestDeliveryResult> {
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('app_type', 'admin');

  if (error) {
    throw new Error('Unable to read the current user push tokens');
  }

  if (!tokens || tokens.length === 0) {
    return { failed: 0, sent: 0, uncertain: 0 };
  }

  const messages: ExpoPushMessage[] = tokens.map(({ token }) => ({
    body,
    channelId: 'admin',
    data: { source: 'admin_push_test', type: 'admin_push_test' },
    priority: 'default',
    sound: 'default',
    title,
    to: token,
  }));

  try {
    const expo = new Expo({ accessToken: readServerExpoAccessToken() });
    const { deliveryUncertain, tickets } = await sendPushNotificationChunks(
      expo,
      messages
    );
    const failed = tickets.filter((ticket) => ticket.status === 'error').length;
    // A provider throw yields synthetic error tickets plus
    // deliveryUncertain: report them as uncertain instead of
    // definitive failures so a test push is never misreported.
    if (deliveryUncertain) {
      return { failed: 0, sent: tickets.length - failed, uncertain: failed };
    }
    return { failed, sent: tickets.length - failed, uncertain: 0 };
  } catch {
    return { failed: tokens.length, sent: 0, uncertain: 0 };
  }
}
