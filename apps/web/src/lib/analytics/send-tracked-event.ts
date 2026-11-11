'use client';

import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import type { TrackedEvent } from './tracked-event-types';

// Get or create session ID
function getSessionId(): string {
  if (typeof window === 'undefined') return '';

  let sessionId = sessionStorage.getItem('baci_session_id');
  if (!sessionId) {
    // Use crypto.randomUUID() for cryptographically secure session IDs
    sessionId = `sess_${crypto.randomUUID()}`;
    sessionStorage.setItem('baci_session_id', sessionId);
  }
  return sessionId;
}

// Get common event metadata
function getEventMetadata(): Record<string, string | undefined> {
  if (typeof window === 'undefined') return {};

  return {
    session_id: getSessionId(),
    user_agent: navigator.userAgent,
    referrer: document.referrer || undefined,
    page_url: window.location.href,
  };
}

// Stay under the browser's 64 KB in-flight keepalive budget.
const KEEPALIVE_BODY_LIMIT = 60_000;

// Send event to our API (stores in Supabase)
export async function sendTrackedEvent(event: TrackedEvent): Promise<void> {
  try {
    const body = JSON.stringify({
      ...event,
      ...getEventMetadata(),
      analytics_consent: isAnalyticsAllowed(),
      marketing_consent: isMarketingAllowed(),
      timestamp: new Date().toISOString(),
    });
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // Let the request outlive the page so an add-to-cart or checkout
      // click that navigates away is still recorded. Browsers cap
      // in-flight keepalive bodies at 64 KB, so oversized payloads fall
      // back to a normal request instead of being rejected.
      keepalive:
        new TextEncoder().encode(body).byteLength <= KEEPALIVE_BODY_LIMIT,
    });

    if (!response.ok) {
      console.warn('Failed to track event:', event.event_type);
    }
  } catch (error) {
    // Silently fail - don't break user experience for analytics
    console.warn('Event tracking error:', error);
  }
}
