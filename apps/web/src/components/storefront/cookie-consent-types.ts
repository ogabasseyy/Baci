export const COOKIE_CONSENT_KEY = 'baci-cookie-consent';

export interface CookiePreferences {
  necessary: boolean; // Always true, required for site functionality
  analytics: boolean; // Google Analytics, etc.
  marketing: boolean; // Ad tracking, retargeting
  functional: boolean; // Preferences, language settings
}
