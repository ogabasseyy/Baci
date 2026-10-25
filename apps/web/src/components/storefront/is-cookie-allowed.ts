import {
  COOKIE_CONSENT_KEY,
  type CookiePreferences,
} from './cookie-consent-types';

/**
 * Check if a specific cookie category is allowed
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
