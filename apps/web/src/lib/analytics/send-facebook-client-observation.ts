import { isAnalyticsAllowed } from '@/lib/analytics-consent';

interface FacebookObservation {
  baseUrl: string;
  event: 'Purchase' | 'InitiateCheckout' | 'AddToCart' | 'ViewContent';
  merchantId: string;
  userData: Record<string, string | undefined>;
  eventData: Record<string, unknown>;
  eventSourceUrl?: string;
  eventId?: string;
}

export interface FacebookObservationResult {
  platform: 'Facebook';
  success: boolean;
  sent: boolean;
  queued?: boolean;
  error?: string;
}

/** Browser ingress acceptance is distinct from the worker's provider receipt. */
export async function sendFacebookClientObservation({
  baseUrl,
  ...input
}: FacebookObservation): Promise<FacebookObservationResult> {
  if (input.event === 'Purchase') {
    return {
      platform: 'Facebook',
      success: false,
      sent: false,
      error: 'untrusted_purchase',
    };
  }
  if (!isAnalyticsAllowed()) {
    return {
      platform: 'Facebook',
      success: false,
      sent: false,
      error: 'consent_required',
    };
  }
  try {
    const response = await fetch(`${baseUrl}/api/analytics/facebook-capi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...input,
        consent: true,
        eventSourceUrl:
          input.eventSourceUrl ??
          (typeof window !== 'undefined' ? window.location.href : undefined),
      }),
    });
    const data: unknown = await response.json();
    const body =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const queued = response.ok !== false && body.queued === true;
    return {
      platform: 'Facebook',
      success: response.ok !== false && (queued || body.success === true),
      sent: queued
        ? false
        : response.ok !== false && body.success === true && body.sent !== false,
      queued,
      ...(typeof body.error === 'string' ? { error: body.error } : {}),
    };
  } catch (error) {
    return {
      platform: 'Facebook',
      success: false,
      sent: false,
      error: error instanceof Error ? error.message : 'event_queue_unavailable',
    };
  }
}
