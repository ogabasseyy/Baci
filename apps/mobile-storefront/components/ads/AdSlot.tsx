import { useIsFocused } from 'expo-router';
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
import { useUIStore } from '@/stores/ui-store';

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
 * is gathered and the under-age request configuration is applied. Route
 * focus gates mounting so a consent/SDK initialization that resolves after
 * navigation cannot request an ad on a hidden stack screen.
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
  // The banner is sized to the slot it sits in, not the device: an adaptive
  // banner defaults to full device width, which crops it inside narrower
  // hosts (the navigation drawer, padded cards). A cropped ad breaks AdMob
  // placement policy, so nothing is requested until the width is measured.
  const [slotWidth, setSlotWidth] = useState<number | null>(null);
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
  // Suspended while the drawer covers the screen (open-start through
  // close-complete, including interrupted openings).
  const drawerCovering = useDrawerStore((state) => state.isCovering);
  // A pushed route keeps the previous screen mounted: without this gate a
  // consent/SDK initialization resolving after navigation would mount a
  // native banner and request an ad on the hidden screen.
  const isFocused = useIsFocused();
  // The chat modal is a full-screen native modal that leaves the Expo
  // route focused, so focus alone cannot suspend banners behind chat —
  // including drawer-owned slots, which chat covers too.
  const isChatOpen = useUIStore((state) => state.isChatOpen);
  if (
    config?.enabled !== true ||
    !readiness.canRequestAds ||
    loadFailed ||
    !isFocused ||
    isChatOpen ||
    (drawerCovering && !visibleWhileDrawerOpen)
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
      onLayout={(event) => {
        const measured = Math.floor(event.nativeEvent.layout.width);
        if (measured > 0 && measured !== slotWidth) setSlotWidth(measured);
      }}
      style={styles.slot}
      testID={testID ?? `ad-slot-${placement.toLowerCase().replace(/_/g, '-')}`}
    >
      <Text style={styles.label}>Sponsored</Text>
      <View style={styles.frame}>
        {slotWidth === null ? null : (
          <BannerAd
            // A new width remounts the banner so it makes a fresh request
            // for that size instead of relying on a prop-update reload.
            key={slotWidth}
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
            width={slotWidth}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    alignSelf: 'stretch',
    // Clear space above and below keeps the banner away from neighbouring
    // buttons (AdMob accidental-click guidance).
    marginVertical: 24,
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
