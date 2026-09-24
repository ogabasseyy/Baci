import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Text, View } from 'react-native';
import type {
  QuizLeaderboard,
  QuizLeaderboardEntry,
} from '@/services/quiz-types';
import type { createQuizStyles } from './QuizScreen.styles';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizResultsStandingsProps {
  leaderboard: QuizLeaderboard | null;
  leaderboardError: boolean;
  participantCount: number | null;
  styles: QuizStyles;
}

export function QuizResultsStandings({
  leaderboard,
  leaderboardError,
  participantCount,
  styles,
}: QuizResultsStandingsProps) {
  const markedEntry =
    leaderboard?.entries.find((entry) => entry.isCurrentCustomer) ?? null;
  const topEntries = leaderboard?.entries.slice(0, 4) ?? [];
  const rows: QuizLeaderboardEntry[] = leaderboard
    ? leaderboard.currentPlayer && !markedEntry
      ? [...topEntries, leaderboard.currentPlayer]
      : markedEntry && !topEntries.includes(markedEntry)
        ? [...topEntries, markedEntry]
        : leaderboard.entries.slice(0, 5)
    : [];

  return (
    <View style={styles.finalStandings}>
      <View style={styles.finalStandingsHeader}>
        <View>
          <Text style={styles.finalStandingsTitle}>
            {leaderboard?.status === 'published'
              ? 'Final standings'
              : 'Live standings'}
          </Text>
          {participantCount != null ? (
            <Text style={styles.finalStandingsMeta}>
              {participantCount}{' '}
              {participantCount === 1 ? 'participant' : 'participants'}
            </Text>
          ) : null}
        </View>
        <Ionicons
          name="podium-outline"
          size={22}
          color={styles.finalStandingsTitle.color}
        />
      </View>
      {!leaderboard && !leaderboardError ? (
        <ActivityIndicator
          accessibilityLabel="Loading standings"
          color={styles.finalStandingsTitle.color}
        />
      ) : null}
      {rows.map((entry) => (
        <View
          key={`${entry.rank}-${entry.displayName}`}
          accessibilityLabel={`Rank ${entry.rank}, ${entry.displayName}, score ${entry.score}`}
          style={[
            styles.finalStandingRow,
            entry.isCurrentCustomer
              ? styles.finalStandingCurrentRow
              : undefined,
          ]}
        >
          <Text style={styles.finalStandingRank}>#{entry.rank}</Text>
          <Text numberOfLines={1} style={styles.finalStandingName}>
            {entry.displayName}
            {entry.isCurrentCustomer ? '  (You)' : ''}
          </Text>
          <Text style={styles.finalStandingScore}>{entry.score} pts</Text>
        </View>
      ))}
      {leaderboardError && !leaderboard ? (
        <Text style={styles.eventMeta}>
          Standings are reconnecting. Your result is safely recorded.
        </Text>
      ) : null}
    </View>
  );
}
