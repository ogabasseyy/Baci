import { Text, View } from 'react-native';
import type { QuizLeaderboardEntry } from '@/services/quiz-types';
import { formatQuizStandingTime } from './format-quiz-standing-time';
import type { createQuizLeaderboardStyles } from './QuizLeaderboardScreen.styles';
import { QuizPlayerAvatar } from './QuizPlayerAvatar';

interface QuizLeaderboardRowProps {
  entry: QuizLeaderboardEntry;
  styles: ReturnType<typeof createQuizLeaderboardStyles>;
}

export function QuizLeaderboardRow({ entry, styles }: QuizLeaderboardRowProps) {
  const finishTime = formatQuizStandingTime(entry.totalTimeSeconds);

  return (
    <View
      accessibilityLabel={`Rank ${entry.rank}, ${entry.displayName}, score ${entry.score}`}
      style={[
        styles.rankRow,
        entry.rank <= 3 ? styles.podiumRow : undefined,
        entry.isCurrentCustomer ? styles.currentRankRow : undefined,
      ]}
    >
      <Text
        style={[styles.rank, entry.rank <= 3 ? styles.podiumRank : undefined]}
      >
        #{entry.rank}
      </Text>
      <QuizPlayerAvatar
        accentColor={styles.rank.color}
        displayName={entry.displayName}
        surfaceColor={styles.currentRankRow.backgroundColor}
      />
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.name}>
          {entry.displayName}
          {entry.isCurrentCustomer ? '  (You)' : ''}
        </Text>
        {finishTime ? <Text style={styles.time}>{finishTime}</Text> : null}
      </View>
      <Text style={styles.score}>{entry.score} pts</Text>
    </View>
  );
}
