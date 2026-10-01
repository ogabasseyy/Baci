import { Pressable, Text, View } from 'react-native';
import type { QuizPrizeClaim } from '@/services/quiz';
import type { createQuizStyles } from './QuizScreen.styles';
import { useQuizPrizeClaim } from './use-quiz-prize-claim';

interface QuizPrizeClaimPanelProps {
  prizeClaim: QuizPrizeClaim;
  styles: ReturnType<typeof createQuizStyles>;
}

/**
 * Result-card affordance shown only for a winning submission. Mounts the
 * product-fetching claim hook (which needs the query/merchant providers), so
 * QuizScreen must render it exclusively when a `prizeClaim` is present.
 */
export function QuizPrizeClaimPanel({
  prizeClaim,
  styles,
}: QuizPrizeClaimPanelProps) {
  const {
    claimPrize,
    retry,
    reviewCart,
    isPreparing,
    isReady,
    error,
    blockedReason,
  } = useQuizPrizeClaim(prizeClaim);

  return (
    <View>
      <Text style={styles.prizeWinText}>You won a prize!</Text>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : blockedReason ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {blockedReason}
        </Text>
      ) : (
        <Text style={styles.prizeClaimHint}>
          Continue to checkout to complete your claim.
        </Text>
      )}

      {error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try loading your prize again"
          onPress={retry}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Try again</Text>
        </Pressable>
      ) : blockedReason ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Review your cart"
          onPress={reviewCart}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Review cart</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Claim your prize"
          accessibilityState={{ disabled: !isReady }}
          disabled={!isReady}
          onPress={claimPrize}
          style={[
            styles.primaryButton,
            !isReady && styles.answerButtonDisabled,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            {isPreparing ? 'Preparing your prize…' : 'Claim your prize'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
