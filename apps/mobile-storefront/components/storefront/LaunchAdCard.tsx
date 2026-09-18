import { StyleSheet, Text, View } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import type { MobileAdBannerPlacementKey } from '@/config/mobile-ad-placements';
import { trackEvent } from '@/services/analytics-core';

interface LaunchAdCardColors {
  border: string;
  card: string;
  textSecondary: string;
}

interface LaunchAdCardProps {
  cardWidth: number;
  colors: LaunchAdCardColors;
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
  onAdFailedToLoad,
  placement,
  unitId,
}: LaunchAdCardProps) {
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
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
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
