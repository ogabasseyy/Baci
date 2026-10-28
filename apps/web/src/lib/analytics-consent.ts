import { parseCookiePreferences } from '@/components/storefront/parse-cookie-preferences';
/** A malformed/incomplete choice must not grant tracking while the banner prompts again. */
export function isAnalyticsAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('baci-cookie-consent');
    return raw
      ? parseCookiePreferences(JSON.parse(raw))?.analytics === true
      : false;
  } catch {
    return false;
  }
}
