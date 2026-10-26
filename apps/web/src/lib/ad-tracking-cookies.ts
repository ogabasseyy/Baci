/**
 * Ad Tracking Cookie Utilities
 *
 * Captures and stores click IDs from ad platforms (Facebook, TikTok, Google, Snapchat)
 * to improve conversion attribution when sending offline conversions via CAPI.
 *
 * Click IDs tracked:
 * - fbclid: Facebook click ID
 * - ttclid: TikTok click ID
 * - gclid: Google click ID
 * - sccid: Snapchat click ID
 *
 * Browser IDs tracked:
 * - _fbp: Facebook browser pixel ID (set by Facebook Pixel)
 * - _ttp: TikTok browser ID (set by TikTok Pixel)
 * - _ga: Google Analytics client ID
 */

import { isAnalyticsAllowed } from './analytics-consent';
import { isMarketingAllowed } from './marketing-consent';

// Cookie names for ad tracking
export const AD_TRACKING_COOKIES = {
  // Click IDs (captured from URL params)
  FACEBOOK_CLICK_ID: 'baci_fbclid',
  TIKTOK_CLICK_ID: 'baci_ttclid',
  GOOGLE_CLICK_ID: 'baci_gclid',
  SNAPCHAT_CLICK_ID: 'baci_sccid',
  // Browser IDs (read from platform cookies)
  FACEBOOK_BROWSER_ID: '_fbp',
  TIKTOK_BROWSER_ID: '_ttp',
  GA_CLIENT_ID: '_ga',
} as const;

// URL parameter names to capture
// Dispatched on `window` by the inline attribution-capture script after
// /api/attr has (asynchronously) set the baci_* cookie, so client hooks that
// snapshot cookies at mount (useAdTracking) can re-read once the cookie lands —
// covers direct-to-checkout ad landings where the hook mounts before the fetch
// resolves.
export const AD_ATTRIBUTION_UPDATED_EVENT = 'baci:ad-attribution-updated';

export const CLICK_ID_PARAMS = {
  fbclid: AD_TRACKING_COOKIES.FACEBOOK_CLICK_ID,
  ttclid: AD_TRACKING_COOKIES.TIKTOK_CLICK_ID,
  gclid: AD_TRACKING_COOKIES.GOOGLE_CLICK_ID,
  sccid: AD_TRACKING_COOKIES.SNAPCHAT_CLICK_ID,
} as const;

// Cookie expiry: 90 days (matches Facebook's fbclid cookie)
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60; // 90 days in seconds

/**
 * Interface for captured ad tracking data
 */
export interface AdTrackingData {
  oppref?: string;
  obref?: string;
  chatgptConsent?: boolean;
  marketingConsent?: boolean;
  twclid?: string;
  // Click IDs from URL params
  fbclid?: string;
  ttclid?: string;
  gclid?: string;
  sccid?: string;
  // Browser IDs from platform cookies
  fbp?: string;
  ttp?: string;
  gaClientId?: string;
  // User context for better Event Match Quality (EMQ)
  userIp?: string;
  userAgent?: string;
  // Event deduplication ID (shared between Pixel and CAPI)
  eventId?: string;
  // Privacy flags
  limitedDataUse?: boolean; // For CCPA compliance
}

/**
 * Extract click IDs from URL search params
 * Call this when a user lands on your site from an ad
 */
export function extractClickIdsFromUrl(
  searchParams: URLSearchParams
): Partial<Record<keyof typeof CLICK_ID_PARAMS, string>> {
  const clickIds: Partial<Record<keyof typeof CLICK_ID_PARAMS, string>> = {};

  for (const [param] of Object.entries(CLICK_ID_PARAMS)) {
    const value = searchParams.get(param);
    if (value) {
      clickIds[param as keyof typeof CLICK_ID_PARAMS] = value;
    }
  }

  return clickIds;
}

/**
 * Generate cookie string for setting click ID cookies
 * Used by middleware to set cookies on the response
 */
export function generateClickIdCookies(
  clickIds: Partial<Record<keyof typeof CLICK_ID_PARAMS, string>>,
  domain?: string
): string[] {
  const cookies: string[] = [];

  for (const [param, cookieName] of Object.entries(CLICK_ID_PARAMS)) {
    const value = clickIds[param as keyof typeof CLICK_ID_PARAMS];
    if (value) {
      const domainPart = domain ? `; Domain=${domain}` : '';
      cookies.push(
        `${cookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure${domainPart}`
      );
    }
  }

  return cookies;
}

/**
 * Parse cookies string to get ad tracking data
 * Works on both client and server
 */
export function parseAdTrackingCookies(cookieString: string): AdTrackingData {
  const allowedNames = new Set<string>([
    '__oppref',
    '__obref',
    ...Object.values(AD_TRACKING_COOKIES),
  ]);
  const cookies = Object.fromEntries(
    cookieString.split(';').flatMap((c) => {
      const [key, ...valueParts] = c.trim().split('=');
      if (!allowedNames.has(key) || valueParts.length === 0) return [];
      try {
        return [[key, decodeURIComponent(valueParts.join('='))]];
      } catch {
        // A malformed optional reference must not stop an order submission.
        return [];
      }
    })
  );

  return {
    oppref: cookies.__oppref,
    obref: cookies.__obref,
    // Our captured click IDs
    fbclid: cookies[AD_TRACKING_COOKIES.FACEBOOK_CLICK_ID],
    ttclid: cookies[AD_TRACKING_COOKIES.TIKTOK_CLICK_ID],
    gclid: cookies[AD_TRACKING_COOKIES.GOOGLE_CLICK_ID],
    sccid: cookies[AD_TRACKING_COOKIES.SNAPCHAT_CLICK_ID],
    // Platform browser IDs (set by their pixels)
    fbp: cookies[AD_TRACKING_COOKIES.FACEBOOK_BROWSER_ID],
    ttp: cookies[AD_TRACKING_COOKIES.TIKTOK_BROWSER_ID],
    gaClientId: extractGaClientId(cookies[AD_TRACKING_COOKIES.GA_CLIENT_ID]),
  };
}

/**
 * Extract GA client ID from _ga cookie
 * _ga cookie format: GA1.1.123456789.1234567890
 * Client ID is the last two parts: 123456789.1234567890
 */
function extractGaClientId(gaCookie?: string): string | undefined {
  if (!gaCookie) return undefined;

  const parts = gaCookie.split('.');
  if (parts.length >= 4) {
    // Return the last two parts as the client ID
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }

  return undefined;
}

/**
 * Client-side function to get ad tracking data from document.cookie
 */
export function getAdTrackingData(): AdTrackingData {
  if (typeof document === 'undefined') {
    return {};
  }

  let tracking: AdTrackingData = {};
  try {
    tracking = parseAdTrackingCookies(document.cookie);
  } catch {
    // Cookie access can itself be denied. Checkout still proceeds without IDs.
  }
  const allowed = isAnalyticsAllowed();
  if (!allowed) {
    delete tracking.oppref;
    delete tracking.obref;
  }
  const marketingConsent = isMarketingAllowed();
  const twclid = marketingConsent
    ? new URLSearchParams(window.location.search).get('twclid')
    : null;
  return {
    ...tracking,
    chatgptConsent: allowed,
    marketingConsent,
    ...(twclid && /^[A-Za-z0-9_-]{1,256}$/.test(twclid) ? { twclid } : {}),
  };
}

/**
 * Generate Facebook _fbc cookie value from fbclid
 * Format: fb.1.{timestamp}.{fbclid}
 * This is used when sending CAPI events for better matching
 */
export function generateFbc(fbclid: string): string {
  const timestamp = Date.now();
  return `fb.1.${timestamp}.${fbclid}`;
}

/**
 * Generate a unique event ID for deduplication between Pixel and CAPI
 * This ID should be used for both client-side Pixel events AND server-side CAPI events
 * Format: {timestamp}_{random} for uniqueness
 */
export function generateEventId(): string {
  const timestamp = Date.now();
  const random = crypto.randomUUID().replace(/-/g, '').substring(0, 10);
  return `${timestamp}_${random}`;
}

/**
 * Get ad tracking data formatted for order storage
 * Call this when creating an order to store click IDs with the order
 *
 * @param userIp - Optional IP address from request headers
 * @param userAgent - Optional user agent from request headers
 * @param eventId - Optional event ID for deduplication (generate with generateEventId())
 * @param limitedDataUse - Set to true for California users (CCPA compliance)
 */
export function getTrackingDataForOrder(options?: {
  userIp?: string;
  userAgent?: string;
  eventId?: string;
  limitedDataUse?: boolean;
}): AdTrackingData {
  const data = getAdTrackingData();

  return {
    ...data,
    userIp: options?.userIp,
    userAgent: options?.userAgent,
    eventId: options?.eventId,
    limitedDataUse: options?.limitedDataUse,
  };
}

/**
 * Detect if user is in California (for CCPA/LDU compliance)
 * This is a simplified check - in production you might use a geo-IP service
 */
export function shouldApplyLimitedDataUse(timezone?: string): boolean {
  // Check if user's timezone is in California
  // America/Los_Angeles is the primary California timezone
  if (timezone === 'America/Los_Angeles') {
    return true;
  }
  return false;
}
