import { getStoredConsent } from '@/lib/consent-mode';

export function isValidTikTokPixelId(id: string): boolean {
  return /^[A-Za-z0-9]{1,64}$/.test(id);
}
export function isValidSnapchatPixelId(id: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    id
  );
}
export function subscribeSocialMarketingConsent(
  onChange: () => void
): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('cookie-consent-updated', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('cookie-consent-updated', onChange);
  };
}
export function getSocialMarketingConsent(): boolean {
  return getStoredConsent()?.marketing === true;
}
export function getSocialServerConsent(): boolean {
  return false;
}
