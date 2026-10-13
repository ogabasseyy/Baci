import 'server-only';

import type { AdsProvider } from './contract';

const BACI_ORIGIN = 'https://usebaci.com';

const ADS_CALLBACK_PATHS: Record<AdsProvider, string> = {
  google_ads: '/api/integrations/ads/google/callback',
  meta_ads: '/api/integrations/ads/meta/callback',
  snapchat_ads: '/api/integrations/ads/snapchat/callback',
  tiktok_ads: '/api/integrations/ads/tiktok/callback',
};

export class AdsConfigError extends Error {
  readonly code = 'ADS_CONFIG_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AdsConfigError';
  }
}

export function getCanonicalAdsCallbackUri(provider: AdsProvider): string {
  return `${BACI_ORIGIN}${ADS_CALLBACK_PATHS[provider]}`;
}

export function validateCanonicalAdsCallbackUri(
  provider: AdsProvider,
  redirectUri: string
): string {
  const expected = getCanonicalAdsCallbackUri(provider);
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new AdsConfigError(
      'Ads OAuth callback must be a canonical HTTPS URL'
    );
  }
  if (
    redirectUri !== expected ||
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'usebaci.com' ||
    parsed.port !== '' ||
    parsed.pathname !== ADS_CALLBACK_PATHS[provider] ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.toString() !== expected
  ) {
    throw new AdsConfigError(
      'Ads OAuth callback must match its canonical provider route'
    );
  }
  return expected;
}
