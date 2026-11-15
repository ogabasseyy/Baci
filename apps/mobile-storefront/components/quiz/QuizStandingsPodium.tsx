import { Text, View } from 'react-native';
import type { QuizLeaderboardEntry } from '@/services/quiz-types';
import { formatQuizStandingTime } from './format-quiz-standing-time';
import { QuizPlayerAvatar } from './QuizPlayerAvatar';
import { QUIZ_PODIUM_MEDALS } from './QuizResults.styles';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizStandingsPodiumProps {
  /** Ranks 1 to 3, in rank order. */
  entries: QuizLeaderboardEntry[];
  /** Show each player's finish time, the tie-breaker, under their score. */
  showFinishTime?: boolean;
  styles: QuizStyles;
}

/** Second, first, third: the winner stands in the middle on the tallest step. */
const PODIUM_ORDER = [1, 0, 2] as const;

export function QuizStandingsPodium({
  entries,
  showFinishTime = false,
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
        const finishTime = showFinishTime
          ? formatQuizStandingTime(entry.totalTimeSeconds)
          : null;
        return (
          <View
            key={position}
            accessibilityLabel={`Rank ${entry.rank}, ${entry.displayName}, score ${entry.score}`}
            style={styles.podiumColumn}
          >
            <QuizPlayerAvatar
              accentColor={medal}
              displayName={entry.displayName}
              // Only the player's own avatar gets the highlight wash.
              surfaceColor={
                entry.isCurrentCustomer
                  ? styles.finalStandingCurrentRow.backgroundColor
                  : styles.resultIcon.backgroundColor
              }
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
            {finishTime ? (
              <Text style={styles.podiumScore}>{finishTime}</Text>
            ) : null}
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
