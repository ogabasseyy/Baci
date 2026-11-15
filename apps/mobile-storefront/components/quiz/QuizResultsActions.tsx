import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { createQuizStyles } from './QuizScreen.styles';
import { formatQuizTriesLeft } from './QuizScreen.utils';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizResultsActionsProps {
  onReturnToQuizList?: () => void;
  returnLabel: 'Back to quizzes' | 'Play again';
  showHistory: boolean;
  styles: QuizStyles;
  /** Shown beside "Play again" only when known. */
  triesLeft?: number | null;
}

export function QuizResultsActions({
  onReturnToQuizList,
  returnLabel,
  showHistory,
  styles,
  triesLeft = null,
}: QuizResultsActionsProps) {
  const router = useRouter();
  const triesText =
    returnLabel === 'Play again' ? formatQuizTriesLeft(triesLeft) : null;
  const visibleLabel = triesText ? `Play again · ${triesText}` : returnLabel;
  if (!showHistory && !onReturnToQuizList) return null;

  return (
    <View style={styles.resultActionsDock} testID="quiz-results-actions">
      {showHistory ? (
        <View style={styles.resultActionBox}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View past quiz leaderboards"
            onPress={() => router.push('/quiz/leaderboards')}
            style={styles.resultAction}
          >
            <Ionicons
              name="podium-outline"
              size={19}
              color={styles.secondaryButtonText.color}
            />
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={styles.secondaryButtonText}
            >
              View past leaderboards
            </Text>
          </Pressable>
        </View>
      ) : null}
      {onReturnToQuizList ? (
        <View style={styles.resultActionBox}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              returnLabel === 'Play again'
                ? visibleLabel
                : 'Return to quiz list'
            }
            onPress={onReturnToQuizList}
            style={styles.resultAction}
          >
            <Ionicons
              name="arrow-back"
              size={19}
              color={styles.secondaryButtonText.color}
            />
            <Text
              adjustsFontSizeToFit
              numberOfLines={1}
              style={styles.secondaryButtonText}
            >
              {visibleLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
