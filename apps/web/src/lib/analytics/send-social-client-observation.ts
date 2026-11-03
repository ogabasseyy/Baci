import { isMarketingAllowed } from '@/lib/marketing-consent';

interface SocialObservation {
  baseUrl: string;
  event: 'purchase' | 'view_item' | 'add_to_cart' | 'begin_checkout';
  merchantId: string;
  eventData: Record<string, unknown>;
  eventId?: string;
  eventSourceUrl?: string;
}
export interface SocialObservationResult {
  platform: 'TikTok' | 'Snapchat';
  success: boolean;
  sent: boolean;
  queued?: boolean;
  error?: string;
}
/** A visitor may queue an observation; paid conversions are owned by the server. */
export async function sendSocialClientObservation(
  destination: 'tiktok' | 'snapchat',
  input: SocialObservation
): Promise<SocialObservationResult> {
  const platform = destination === 'tiktok' ? 'TikTok' : 'Snapchat';
  if (!isMarketingAllowed())
    return { platform, success: false, sent: false, error: 'consent_required' };
  if (input.event === 'purchase')
    return {
      platform,
      success: false,
      sent: false,
      error: 'untrusted_purchase',
    };
  try {
    const response = await fetch(
      `${input.baseUrl}/api/analytics/${destination}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: input.event,
          merchantId: input.merchantId,
          eventData: input.eventData,
          eventId: input.eventId,
          consent: true,
          eventSourceUrl: input.eventSourceUrl ?? window.location.href,
        }),
      }
    );
    const data: unknown = await response.json();
    const body =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const queued = response.ok !== false && body.queued === true;
    return {
      platform,
      success: queued,
      sent: false,
      queued,
      ...(typeof body.error === 'string' ? { error: body.error } : {}),
    };
  } catch {
    return {
      platform,
      success: false,
      sent: false,
      error: 'event_queue_unavailable',
    };
  }
}
