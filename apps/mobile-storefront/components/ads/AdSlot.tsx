import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import {
  getMobileAdUnitId,
  type MobileAdBannerPlacementKey,
} from '@/config/mobile-ad-placements';
import { BRAND } from '@/constants/Colors';
import { useMobileAdsReadiness } from '@/hooks/use-mobile-ads-readiness';
import { trackEvent } from '@/services/analytics-core';
import { useDrawerStore } from '@/stores/drawer-store';

type AdSlotProps = {
  placement: MobileAdBannerPlacementKey;
  testID?: string;
  /**
   * Set only by the drawer-owned slot. Every other slot suspends while the
   * navigation drawer is open so a single FOOTER_ANCHOR request stays live
   * and impressions attribute to the visible screen.
   */
  visibleWhileDrawerOpen?: boolean;
};

function getAdErrorCode(error: Error): string {
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'unknown';
}

/**
 * App-wide banner slot. Resolves its unit ID from the placement registry
 * (sample IDs in dev, per-placement production IDs), renders nothing while
 * ads are disabled or UMP consent is unresolved, unmounts after a no-fill
 * or load error so no blank "Sponsored" slot is retained, suspends while
 * the navigation drawer is open (unless marked drawer-owned) so duplicate
 * placements never request in parallel, and keeps the native module behind
 * a lazy require so builds without Google Mobile Ads keep working.
 * Consent readiness gates the request so banners never fire before consent
 * is gathered and the under-age request configuration is applied.
 */
export function AdSlot({
  placement,
  testID,
  visibleWhileDrawerOpen = false,
}: AdSlotProps) {
  // Dropped when the banner reports no fill or a load error so generic
  // placements never retain a blank "Sponsored" slot. Declared with the
  // other hooks, above the early returns.
  const [loadFailed, setLoadFailed] = useState(false);
  let config: ReturnType<typeof getMobileAdUnitId> | null = null;
  try {
    config = getMobileAdUnitId(placement);
  } catch {
    // A misconfigured placement must never crash the hosting screen.
    config = null;
  }
  const readiness = useMobileAdsReadiness({
    enabled: config?.enabled === true,
  });
  const drawerOpen = useDrawerStore((state) => state.isOpen);
  if (
    config?.enabled !== true ||
    !readiness.canRequestAds ||
    loadFailed ||
    (drawerOpen && !visibleWhileDrawerOpen)
  ) {
    return null;
  }

  // Builds without the Google Mobile Ads native module (e.g. Expo Go) throw
  // on require; only registry misconfiguration is caught above.
  let bannerModule: typeof import('react-native-google-mobile-ads');
  try {
    bannerModule =
      require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch {
    return null;
  }
  const { BannerAd, BannerAdSize } = bannerModule;

  const handlePaid = (event: PaidEvent) => {
    trackEvent('mobile_ad_paid', {
      currency: event.currency,
      format: 'banner',
      placement,
      precision: String(event.precision),
      valueMicros: event.value,
    });
  };

  return (
    <View
      accessibilityLabel="Sponsored advertisement"
      style={styles.slot}
      testID={testID ?? `ad-slot-${placement.toLowerCase().replace(/_/g, '-')}`}
    >
      <Text style={styles.label}>Sponsored</Text>
      <View style={styles.frame}>
        <BannerAd
          onAdFailedToLoad={(error) => {
            trackEvent('mobile_ad_failed', {
              errorCode: getAdErrorCode(error),
              format: 'banner',
              placement,
            });
            setLoadFailed(true);
          }}
          onAdImpression={() =>
            trackEvent('mobile_ad_impression', {
              format: 'banner',
              placement,
            })
          }
          onPaid={handlePaid}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          unitId={config.unitId}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    color: BRAND.primary,
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  frame: {
    alignItems: 'center',
    minHeight: 50,
    width: '100%',
  },
});
