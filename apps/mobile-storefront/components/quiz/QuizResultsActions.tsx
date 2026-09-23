import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizResultsActionsProps {
  onReturnToQuizList?: () => void;
  returnLabel: 'Back to quizzes' | 'Play again';
  showHistory: boolean;
  styles: QuizStyles;
}

export function QuizResultsActions({
  onReturnToQuizList,
  returnLabel,
  showHistory,
  styles,
}: QuizResultsActionsProps) {
  const router = useRouter();
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
                ? 'Play again'
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
              {returnLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
