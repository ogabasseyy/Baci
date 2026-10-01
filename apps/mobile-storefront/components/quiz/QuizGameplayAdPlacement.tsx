import { Text, View } from 'react-native';
import type { PaidEvent } from 'react-native-google-mobile-ads';
import { trackQuizAdEvent } from '@/services/quiz-ad-analytics';
import type { createQuizGameplayAdFooterStyles } from './QuizGameplayAdFooter.styles';

function getAdErrorCode(error: Error): string {
  if ('code' in error && typeof error.code === 'string') return error.code;
  return 'unknown';
}

interface QuizGameplayAdPlacementProps {
  bannerUnitId: string;
  styles: ReturnType<typeof createQuizGameplayAdFooterStyles>;
}

/**
 * The native module is required only after the ad hook has confirmed that an
 * active placement is available. Keeping that boundary here preserves dev
 * builds that do not include the Google Mobile Ads native module.
 */
export function QuizGameplayAdPlacement({
  bannerUnitId,
  styles,
}: QuizGameplayAdPlacementProps) {
  const { BannerAd, BannerAdSize } =
    require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');

  const handlePaid = (event: PaidEvent) => {
    trackQuizAdEvent('quiz_ad_paid', {
      currency: event.currency,
      precision: String(event.precision),
      valueMicros: event.value,
    });
  };

  return (
    <View
      accessibilityLabel="Sponsored advertisement"
      style={styles.footer}
      testID="quiz-gameplay-ad-footer"
    >
      <Text style={styles.label}>Sponsored</Text>
      <View style={styles.adFrame} testID="quiz-banner-slot">
        <BannerAd
          onAdFailedToLoad={(error) => {
            trackQuizAdEvent('quiz_ad_failed', {
              errorCode: getAdErrorCode(error),
            });
          }}
          onAdImpression={() => trackQuizAdEvent('quiz_ad_impression')}
          onPaid={handlePaid}
          size={BannerAdSize.LARGE_ANCHORED_ADAPTIVE_BANNER}
          unitId={bannerUnitId}
        />
      </View>
    </View>
  );
}
