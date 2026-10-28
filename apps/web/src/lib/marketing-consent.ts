import { parseCookiePreferences } from '@/components/storefront/parse-cookie-preferences';
/** Recheck at send time: loaded SDK globals can outlive the visitor's choice. */
export function isMarketingAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('baci-cookie-consent');
    return raw
      ? parseCookiePreferences(JSON.parse(raw))?.marketing === true
      : false;
  } catch {
    return false;
  }
}
