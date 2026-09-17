import { StyleSheet, Text, View } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import {
  getMobileAdUnitId,
  type MobileAdBannerPlacementKey,
} from '@/config/mobile-ad-placements';
import { BRAND } from '@/constants/Colors';
import { trackEvent } from '@/services/analytics-core';

type AdSlotProps = {
  placement: MobileAdBannerPlacementKey;
  testID?: string;
};

function getAdErrorCode(error: Error): string {
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'unknown';
}

/**
 * App-wide banner slot. Resolves its unit ID from the placement registry
 * (sample IDs in dev, per-placement production IDs), renders nothing while
 * ads are disabled, and keeps the native module behind a lazy require so
 * builds without Google Mobile Ads keep working.
 */
export function AdSlot({ placement, testID }: AdSlotProps) {
  let config: ReturnType<typeof getMobileAdUnitId>;
  try {
    config = getMobileAdUnitId(placement);
  } catch {
    // A misconfigured placement must never crash the hosting screen.
    return null;
  }
  if (!config.enabled) {
    return null;
  }

  const { BannerAd, BannerAdSize } =
    require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');

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
