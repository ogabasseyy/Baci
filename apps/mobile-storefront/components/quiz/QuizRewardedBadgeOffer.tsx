import { Pressable, Text, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { createQuizRewardedBadgeOfferStyles } from './QuizRewardedBadgeOffer.styles';

interface QuizRewardedBadgeOfferProps {
  available: boolean;
  dismiss: () => void;
  isWatching: boolean;
  justEarned: boolean;
  roomBlocked: false;
  watchAd: () => void;
  watchFailed: boolean;
}

export function QuizRewardedBadgeOffer({
  available,
  dismiss,
  isWatching,
  justEarned,
  watchAd,
  watchFailed,
}: QuizRewardedBadgeOfferProps) {
  const { colors } = useTheme();
  const styles = createQuizRewardedBadgeOfferStyles(colors);
  if (!available) return null;

  if (justEarned) {
    return (
      <View accessibilityLabel="Quiz badge earned" style={styles.card}>
        <Text style={styles.title}>Badge earned!</Text>
        <Text style={styles.description}>
          Nicely done — good luck in the quiz!
        </Text>
        <Pressable
          accessibilityLabel="Close badge confirmation"
          accessibilityRole="button"
          onPress={dismiss}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View accessibilityLabel="Quiz badge offer" style={styles.card}>
      <Text style={styles.title}>Earn a badge</Text>
      <Text style={styles.description}>
        Watch a short ad to earn today’s quiz badge
      </Text>
      {watchFailed ? (
        <Text style={styles.error}>Couldn’t load the ad. Try again.</Text>
      ) : null}
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
