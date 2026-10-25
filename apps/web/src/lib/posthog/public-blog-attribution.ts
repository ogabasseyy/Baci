/** Document-scoped acquisition, not a PostHog session or person profile. */
export interface PublicBlogAttribution {
  $referrer: string;
  $referring_domain: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

const CAMPAIGN_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
// Campaign taxonomy tokens only; exclude free text, URLs, emails and phone-like values.
const CAMPAIGN_TOKEN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const PHONE_LIKE = /\d{7}/;
let documentAttribution:
  | { origin: string; properties: PublicBlogAttribution }
  | undefined;

function externalReferrer(currentUrl: URL): PublicBlogAttribution {
  const direct = { $referrer: '$direct', $referring_domain: '$direct' };
  try {
    const referrer = new URL(globalThis.document?.referrer ?? '');
    if (
      !['https:', 'http:'].includes(referrer.protocol) ||
      referrer.username ||
      referrer.password ||
      referrer.hostname === currentUrl.hostname
    ) {
      return direct;
    }
    return { $referrer: referrer.origin, $referring_domain: referrer.hostname };
  } catch {
    return direct;
  }
}

/** Freeze the first observed, consented blog acquisition across SPA routes.
 * Store only in memory, never full queries/referrer paths, never SDK session state.
 */
export function getPublicBlogAttribution(
  currentUrl: URL
): PublicBlogAttribution {
  if (documentAttribution?.origin === currentUrl.origin) {
    return documentAttribution.properties;
  }
  const properties = externalReferrer(currentUrl);
  for (const field of CAMPAIGN_FIELDS) {
    const values = currentUrl.searchParams.getAll(field);
    const value = values[0];
    if (
      values.length === 1 &&
      value &&
      CAMPAIGN_TOKEN.test(value) &&
      !PHONE_LIKE.test(value)
    ) {
      properties[field] = value;
    }
  }
  documentAttribution = { origin: currentUrl.origin, properties };
  return properties;
}

export function resetPublicBlogAttribution(): void {
  documentAttribution = undefined;
}
