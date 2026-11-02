import { getStoredConsent } from '@/lib/consent-mode';

export function getSocialMarketingConsent(): boolean {
  return getStoredConsent()?.marketing === true;
}
