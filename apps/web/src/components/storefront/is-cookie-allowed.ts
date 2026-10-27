import {
  COOKIE_CONSENT_KEY,
  type CookiePreferences,
} from './cookie-consent-types';
import { parseCookiePreferences } from './parse-cookie-preferences';

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
    const consent = parseCookiePreferences(JSON.parse(saved));
    return consent?.[category] === true;
  } catch {
    return false;
  }
}
