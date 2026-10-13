import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Text, View } from 'react-native';
import type {
  QuizLeaderboard,
  QuizLeaderboardEntry,
} from '@/services/quiz-types';
import { formatQuizStandingTime } from './format-quiz-standing-time';
import { QuizPlayerAvatar } from './QuizPlayerAvatar';
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
  const topEntries = leaderboard?.entries.slice(0, 5) ?? [];
  const currentPlayer =
    leaderboard?.currentPlayer ??
    leaderboard?.entries.find((entry) => entry.isCurrentCustomer);
  const currentPlayerIsVisible = currentPlayer
    ? topEntries.some(
        (entry) =>
          entry.isCurrentCustomer ||
          (entry.rank === currentPlayer.rank &&
            entry.displayName === currentPlayer.displayName)
      )
    : false;
  const rows: QuizLeaderboardEntry[] =
    currentPlayer && !currentPlayerIsVisible
      ? [...topEntries, currentPlayer]
      : topEntries;

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
      {rows.map((entry) => {
        const finishTime = formatQuizStandingTime(entry.totalTimeSeconds);
        return (
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
            <QuizPlayerAvatar
              accentColor={styles.finalStandingsTitle.color}
              displayName={entry.displayName}
              surfaceColor={styles.finalStandingCurrentRow.backgroundColor}
            />
            <View style={styles.finalStandingIdentity}>
              <Text numberOfLines={1} style={styles.finalStandingName}>
                {entry.displayName}
                {entry.isCurrentCustomer ? '  (You)' : ''}
              </Text>
              {finishTime ? (
                <Text style={styles.finalStandingTime}>{finishTime}</Text>
              ) : null}
            </View>
            <Text style={styles.finalStandingScore}>{entry.score} pts</Text>
          </View>
        );
      })}
      {leaderboardError && !leaderboard ? (
        <Text style={styles.eventMeta}>
          Standings are reconnecting. Your result is safely recorded.
        </Text>
      ) : null}
    </View>
  );
}
