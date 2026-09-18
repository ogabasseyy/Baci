import { StyleSheet, Text, View } from 'react-native';
import type { MobileAdBannerPlacementKey } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';

interface HeroAdSlideProps {
  height: number;
  /** Configured placement this slot resolves from; used for event attribution. */
  placement: MobileAdBannerPlacementKey;
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
  placement,
  screenWidth,
  unitId,
}: HeroAdSlideProps) {
  // Builds without the Google Mobile Ads native module (e.g. Expo Go) throw
  // on require; render nothing rather than crashing the home feed.
  let bannerModule: typeof import('react-native-google-mobile-ads') | null =
    null;
  try {
    bannerModule =
      require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch {
    return null;
  }
  if (!bannerModule) return null;
  const { BannerAd, BannerAdSize } = bannerModule;

  return (
    <View
      accessibilityLabel="Sponsored advertisement"
      style={[styles.slide, { width: screenWidth, height }]}
      testID="hero-ad-slide"
    >
      <Text style={styles.label}>Sponsored</Text>
      <BannerAd
        onAdFailedToLoad={() =>
          trackEvent('mobile_ad_failed', {
            format: 'banner',
            placement,
          })
        }
        onAdImpression={() =>
          trackEvent('mobile_ad_impression', {
            format: 'banner',
            placement,
          })
        }
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
