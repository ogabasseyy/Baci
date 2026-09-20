import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import { resolveBannerAdModule } from '@/components/ads/banner-ad-module';
import type { MobileAdBannerPlacementKey } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';
import { useDrawerStore } from '@/stores/drawer-store';
import { useUIStore } from '@/stores/ui-store';

interface HeroAdSlideProps {
  height: number;
  /**
   * Whether the sponsored item is currently viewable in the carousel. The
   * native banner mounts only then; otherwise a same-size placeholder
   * preserves paging layout without requesting or refreshing offscreen.
   */
  isVisible: boolean;
  /** Configured placement this slot resolves from; used for event attribution. */
  placement: MobileAdBannerPlacementKey;
  /**
   * Called when AdMob reports no fill or a load error so the carousel can
   * drop the sponsored slide instead of rotating onto a blank page.
   */
  onAdFailedToLoad?: () => void;
  screenWidth: number;
  unitId: string;
}

/**
 * Sponsored slide rendered second in the hero carousel. Impressions and
 * failures are attributed to the configured placement so placement-level
 * monetization reporting stays accurate.
 */
export function HeroAdSlide({
  height,
  isVisible,
  onAdFailedToLoad,
  placement,
  screenWidth,
  unitId,
}: HeroAdSlideProps) {
  // Like AdSlot: suspend while the navigation drawer covers the screen
  // (open-start through close-complete) so the home banner never loads or
  // refreshes under the drawer.
  const drawerCovering = useDrawerStore((state) => state.isCovering);
  // Like AdSlot: a pushed route keeps this screen mounted, so an unfocused
  // route must not own or refresh the banner behind the new screen.
  const isFocused = useIsFocused();
  // Like AdSlot: the full-screen chat modal leaves the route focused.
  const isChatOpen = useUIStore((state) => state.isChatOpen);
  const bannerModule = resolveBannerAdModule();
  useEffect(() => {
    // A missing native module (e.g. Expo Go) is a load failure like any
    // other: report it so the carousel drops the slide instead of rotating
    // onto a blank page it can never fill.
    if (!bannerModule) onAdFailedToLoad?.();
  }, [bannerModule, onAdFailedToLoad]);
  if (!bannerModule) return null;
  // Drawer, focus, chat, and viewability all withhold the native banner
  // but keep the fixed-size placeholder mounted: the carousel still
  // carries the ad slide and its page offset, so unmounting the child
  // would jump the visible hero when the overlay lifts.
  if (!isVisible || drawerCovering || !isFocused || isChatOpen) {
    return (
      <View
        accessibilityLabel="Sponsored advertisement"
        style={[styles.slide, { width: screenWidth, height }]}
        testID="hero-ad-slide"
      />
    );
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
      style={[styles.slide, { width: screenWidth, height }]}
      testID="hero-ad-slide"
    >
      <Text style={styles.label}>Sponsored</Text>
      <BannerAd
        onAdFailedToLoad={() => {
          trackEvent('mobile_ad_failed', {
            format: 'banner',
            placement,
          });
          onAdFailedToLoad?.();
        }}
        onAdImpression={() =>
          trackEvent('mobile_ad_impression', {
            format: 'banner',
            placement,
          })
        }
        onPaid={handlePaid}
        size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
        unitId={unitId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 8,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
});
