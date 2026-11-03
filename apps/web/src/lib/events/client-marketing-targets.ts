import type { AdPlatformTarget } from '@/lib/analytics/ad-platform-target';
/** Derive outbound destinations from bounded purpose-specific visitor grants. */
export function clientMarketingTargets(
  consent: { analytics?: boolean; marketing?: boolean },
  requested: AdPlatformTarget[] = ['facebook', 'google', 'tiktok', 'snapchat']
): AdPlatformTarget[] {
  return requested.filter((target) =>
    target === 'facebook' || target === 'google'
      ? consent.analytics === true
      : consent.marketing === true
  );
}
