import {
  COOKIE_CONSENT_KEY,
  type CookiePreferences,
} from './cookie-consent-types';

/**
 * Imperative consent check for event handlers and effects only.
 * Render consumers must use useCookieConsent, whose server snapshot keeps
 * hydration deterministic and whose subscription follows consent changes.
 */
export function isCookieAllowed(category: keyof CookiePreferences): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const saved = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!saved) return false;
    const consent = JSON.parse(saved) as CookiePreferences;
    return consent[category] ?? false;
  } catch {
    return false;
  }
}
