import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Text, View } from 'react-native';
import type { QuizLeaderboard } from '@/services/quiz-types';
import { formatQuizStandingTime } from './format-quiz-standing-time';
import { QuizPlayerAvatar } from './QuizPlayerAvatar';
import type { createQuizStyles } from './QuizScreen.styles';
import { QuizStandingsPodium } from './QuizStandingsPodium';
import { buildQuizStandingsView } from './quiz-standings-view';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizResultsStandingsProps {
  leaderboard: QuizLeaderboard | null;
  leaderboardError: boolean;
  /** The server is holding the live board back; say so instead of spinning. */
  liveBoardHidden?: boolean;
  participantCount: number | null;
  styles: QuizStyles;
}

export function QuizResultsStandings({
  leaderboard,
  leaderboardError,
  liveBoardHidden = false,
  participantCount,
  styles,
}: QuizResultsStandingsProps) {
  const { podium, rows, pointsBehindTopTen } =
    buildQuizStandingsView(leaderboard);

  // Entries carry no id and tied players can share a name, so a repeat
  // counter keeps every row's key distinct even on an exact tie.
  const repeats = new Map<string, number>();
  const keyedRows = rows.map((entry) => {
    const base = `${entry.rank}-${entry.displayName}`;
    const repeat = repeats.get(base) ?? 0;
    repeats.set(base, repeat + 1);
    return { entry, key: `${base}-${repeat}` };
  });

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
      {!leaderboard && liveBoardHidden ? (
        <Text style={styles.standingsHidden}>
          Standings open when the quiz ends.
        </Text>
      ) : null}
      {!leaderboard && !leaderboardError && !liveBoardHidden ? (
        <ActivityIndicator
          accessibilityLabel="Loading standings"
          color={styles.finalStandingsTitle.color}
        />
      ) : null}
      <QuizStandingsPodium entries={podium} styles={styles} />
      {keyedRows.map(({ entry, key }) => {
        const finishTime = formatQuizStandingTime(entry.totalTimeSeconds);
        return (
          <View
            key={key}
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
      {pointsBehindTopTen !== null ? (
        <Text style={styles.standingsGap}>
          {pointsBehindTopTen === 0
            ? 'Level on points with the top 10'
            : `${pointsBehindTopTen} ${pointsBehindTopTen === 1 ? 'point' : 'points'} behind the top 10`}
        </Text>
      ) : null}
      {leaderboardError && !leaderboard ? (
        <Text style={styles.eventMeta}>
          Standings are reconnecting. Your result is safely recorded.
        </Text>
      ) : null}
    </View>
  );
}
