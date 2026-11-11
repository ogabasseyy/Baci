const KEPT_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  // Ad click ids are opaque and needed for ad-platform attribution.
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'ttclid',
  'msclkid',
  'ScCid',
];

/**
 * Page URLs and referrers are stored in analytics_events. Query strings can
 * carry shopper email, phone, names and one-time tokens (for example the
 * BNPL checkout link), so keep only campaign attribution parameters and drop
 * credentials, fragments and everything else.
 */
export function redactStoredPageUrl(value: string): string {
  if (!/[?#@]/.test(value)) return value;
  try {
    const url = new URL(value);
    const kept = new URLSearchParams();
    for (const key of KEPT_PARAMS) {
      const param = url.searchParams.get(key);
      if (param) kept.set(key, param.slice(0, 500));
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = kept.toString();
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? '';
  }
}
