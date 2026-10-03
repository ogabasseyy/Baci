import type { SupabaseClient } from '@supabase/supabase-js';
import Expo, { type ExpoPushMessage } from 'expo-server-sdk';
import { sendPushNotificationChunks } from '@/lib/expo-push-chunk-delivery';
import { createDeliveryStartBoundary } from '@/lib/push-delivery-boundary';

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

  const deliveryBoundary = createDeliveryStartBoundary();
  try {
    const expo = new Expo({ accessToken: readServerExpoAccessToken() });
    const { deliveryUncertain, tickets } = await sendPushNotificationChunks(
      expo,
      messages,
      { onDeliveryStart: deliveryBoundary.markDeliveryStarted }
    );
    const errorTickets = tickets.filter((ticket) => ticket.status === 'error');
    // A provider throw yields synthetic ExpoError tickets plus
    // deliveryUncertain: report those as uncertain instead of
    // definitive failures so a test push is never misreported. Only
    // the exact ExpoError code converts — both synthetic sites hardcode
    // it, so any other code (DeviceNotRegistered, a future Expo code,
    // or a missing details shape) is a real ticket and stays a
    // definitive failure even when another message's throw made the
    // batch uncertain. Converting wholesale would hide an invalid
    // token behind that throw.
    const uncertainTickets = deliveryUncertain
      ? errorTickets.filter(
          (ticket) =>
            (ticket.details as { error?: unknown } | undefined)?.error ===
            'ExpoError'
        )
      : [];
    const failed = errorTickets.length - uncertainTickets.length;
    return {
      failed,
      sent: tickets.length - errorTickets.length,
      uncertain: uncertainTickets.length,
    };
  } catch {
    // Locally-invalid tokens never dispatch: chunk delivery rejects
    // them with definitive DeviceNotRegistered tickets before any
    // provider request. Use the same predicate here so a
    // post-dispatch throw reports only dispatch-eligible tokens as
    // uncertain, never a token that provably sent nothing.
    const locallyInvalid = tokens.filter(
      ({ token }) => !Expo.isExpoPushToken(token)
    ).length;
    const dispatchEligible = tokens.length - locallyInvalid;
    // A throw before dispatch (chunking, client setup) definitely
    // sent nothing; a throw after dispatch started (e.g. the
    // per-message fallback) may have delivered.
    if (deliveryBoundary.wasDeliveryStarted()) {
      return { failed: locallyInvalid, sent: 0, uncertain: dispatchEligible };
    }
    return { failed: tokens.length, sent: 0, uncertain: 0 };
  }
}
