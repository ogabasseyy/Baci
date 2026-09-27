import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformEventRequestInput } from '@/schemas/platform-event';
import type { PlatformEventType } from './platform-event-forwarding';

export async function persistLegacyPlatformEvent(
  supabase: SupabaseClient,
  args: {
    eventData?: PlatformEventRequestInput['event_data'];
    eventId: string;
    eventTimestamp: string;
    eventType: PlatformEventType;
    ipAddress?: string;
    merchantId?: string;
    pageUrl?: string;
    referrer?: string;
    sessionId?: string;
    userAgent?: string;
  }
) {
  // Targeted ON CONFLICT also applies SELECT policies. This capability is
  // intentionally insert-only, so preserve idempotency without requesting reads.
  const { error } = await supabase.from('platform_events').insert({
    event_data: args.eventData || {},
    event_id: args.eventId,
    event_timestamp: args.eventTimestamp,
    event_type: args.eventType,
    ip_address: args.ipAddress,
    merchant_id: args.merchantId || null,
    page_url: args.pageUrl,
    referrer: args.referrer,
    session_id: args.sessionId,
    user_agent: args.userAgent,
  });
  const duplicate =
    error?.code === '23505' &&
    error.message.includes('"platform_events_type_event_id_uidx"');
  return { error: duplicate ? null : error, duplicate };
}
