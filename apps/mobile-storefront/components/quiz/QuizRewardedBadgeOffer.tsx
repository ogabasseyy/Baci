import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { createQuizRewardedBadgeOfferStyles } from './QuizRewardedBadgeOffer.styles';

interface QuizRewardedBadgeOfferProps {
  available: boolean;
  dismiss: () => void;
  isWatching: boolean;
  roomBlocked: false;
  watchAd: () => void;
}

export function QuizRewardedBadgeOffer({
  available,
  dismiss,
  isWatching,
  watchAd,
}: QuizRewardedBadgeOfferProps) {
  const { colors } = useTheme();
  const styles = createQuizRewardedBadgeOfferStyles(colors);
  if (!available) return null;

  return (
    <View accessibilityLabel="SuperQuiz badge offer" style={styles.card}>
      <Text style={styles.title}>Unlock a SuperQuiz profile badge</Text>
      <Text style={styles.description}>
        Watch a short ad to unlock today’s quiz badge
      </Text>
      <Pressable
        accessibilityLabel="Watch ad"
        accessibilityRole="button"
        accessibilityState={{ disabled: isWatching }}
        disabled={isWatching}
        onPress={watchAd}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>
          {isWatching ? 'Loading ad…' : 'Watch ad'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Not now"
        accessibilityRole="button"
        onPress={dismiss}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>Not now</Text>
      </Pressable>
    </View>
  );
}
