import type { CookiePreferences } from './cookie-consent-types';

/** Accept only a complete consent choice with actual boolean category values. */
export function parseCookiePreferences(
  value: unknown
): CookiePreferences | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  if (
    !('necessary' in value) ||
    typeof value.necessary !== 'boolean' ||
    !('analytics' in value) ||
    typeof value.analytics !== 'boolean' ||
    !('marketing' in value) ||
    typeof value.marketing !== 'boolean' ||
    !('functional' in value) ||
    typeof value.functional !== 'boolean'
  )
    return null;
  return {
    necessary: value.necessary,
    analytics: value.analytics,
    marketing: value.marketing,
    functional: value.functional,
  };
}
