import { Text, View } from 'react-native';
import type { QuizLeaderboardEntry } from '@/services/quiz-types';
import { QuizPlayerAvatar } from './QuizPlayerAvatar';
import { QUIZ_PODIUM_MEDALS } from './QuizResults.styles';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizStandingsPodiumProps {
  /** Ranks 1 to 3, in rank order. */
  entries: QuizLeaderboardEntry[];
  styles: QuizStyles;
}

/** Second, first, third: the winner stands in the middle on the tallest step. */
const PODIUM_ORDER = [1, 0, 2] as const;

export function QuizStandingsPodium({
  entries,
  styles,
}: QuizStandingsPodiumProps) {
  if (entries.length < 3) return null;
  const stepStyles = [
    styles.podiumStepFirst,
    styles.podiumStepSecond,
    styles.podiumStepThird,
  ];
  return (
    <View style={styles.podium} testID="quiz-standings-podium">
      {PODIUM_ORDER.map((position) => {
        const entry = entries[position];
        if (!entry) return null;
        const medal = QUIZ_PODIUM_MEDALS[position] as string;
        return (
          <View
            key={`${entry.rank}-${entry.displayName}`}
            accessibilityLabel={`Rank ${entry.rank}, ${entry.displayName}, score ${entry.score}`}
            style={styles.podiumColumn}
          >
            <QuizPlayerAvatar
              accentColor={medal}
              displayName={entry.displayName}
              surfaceColor={styles.finalStandingCurrentRow.backgroundColor}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.podiumName,
                entry.isCurrentCustomer ? styles.podiumYou : undefined,
              ]}
            >
              {entry.isCurrentCustomer ? 'You' : entry.displayName}
            </Text>
            <Text style={styles.podiumScore}>{entry.score} pts</Text>
            <View
              style={[
                styles.podiumStep,
                stepStyles[position],
                { backgroundColor: medal },
              ]}
            >
              <Text style={styles.podiumRank}>{entry.rank}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
