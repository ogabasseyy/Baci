import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import { resolveBannerAdModule } from '@/components/ads/banner-ad-module';
import type { MobileAdBannerPlacementKey } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';
import { useDrawerStore } from '@/stores/drawer-store';
import { useUIStore } from '@/stores/ui-store';

interface LaunchAdCardColors {
  border: string;
  card: string;
  textSecondary: string;
}

interface LaunchAdCardProps {
  cardWidth: number;
  colors: LaunchAdCardColors;
  /**
   * Whether the sponsored card is currently viewable in the carousel. The
   * native banner mounts only then; otherwise a same-size placeholder
   * preserves list layout without requesting or refreshing offscreen.
   */
  isVisible: boolean;
  /** Configured placement this slot resolves from; used for event attribution. */
  placement: MobileAdBannerPlacementKey;
  /**
   * Called when AdMob reports no fill or a load error so the carousel can
   * drop the sponsored card instead of keeping a blank 168px slot.
   */
  onAdFailedToLoad?: () => void;
  unitId: string;
}

/**
 * Sponsored card inserted into the Just Launched carousel. Impressions and
 * failures are attributed to the configured placement so placement-level
 * monetization reporting stays accurate. Renders nothing when the Google
 * Mobile Ads native module is unavailable (e.g. Expo Go) rather than
 * crashing the carousel.
 */
export function LaunchAdCard({
  cardWidth,
  colors,
  isVisible,
  onAdFailedToLoad,
  placement,
  unitId,
}: LaunchAdCardProps) {
  // Like AdSlot: suspend while the navigation drawer covers the screen
  // (open-start through close-complete) so the card never loads or
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
    // other: report it so the carousel drops the card instead of showing a
    // blank page and skewing offset compensation.
    if (!bannerModule) onAdFailedToLoad?.();
  }, [bannerModule, onAdFailedToLoad]);
  if (!bannerModule) return null;
  // Drawer, focus, chat, and viewability all withhold the native banner
  // but keep the fixed-size placeholder mounted: the carousel still
  // carries the ad sentinel and its scroll offset, so unmounting the
  // child would clamp the list and jump the visible product when the
  // overlay lifts.
  if (!isVisible || drawerCovering || !isFocused || isChatOpen) {
    return (
      <View
        accessibilityLabel="Sponsored advertisement"
        style={[
          styles.card,
          {
            width: cardWidth,
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
        testID="launch-ad-card"
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
      style={[
        styles.card,
        {
          width: cardWidth,
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
      testID="launch-ad-card"
    >
      <Text style={[styles.adLabel, { color: colors.textSecondary }]}>
        Sponsored
      </Text>
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
        // Inline adaptive sizes to the card width: an anchored creative
        // resolves for the full screen width and would clip horizontally
        // under the card's 82%-of-window width, padding, and overflow.
        size={BannerAdSize.INLINE_ADAPTIVE_BANNER}
        unitId={unitId}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 168,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    padding: 8,
  },
  adLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
});
