import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { fetchQuizEvents } from '@/services/quiz';
import { fetchQuizLeaderboard } from '@/services/quiz-leaderboard';
import type {
  QuizEvent,
  QuizLeaderboard,
  QuizLeaderboardEntry,
} from '@/services/quiz-types';
import { useAuthStore } from '@/stores/auth-store';
import { createQuizLeaderboardStyles } from './QuizLeaderboardScreen.styles';
import { formatQuizClock } from './QuizScreen.utils';

function getLeaderboardRows(leaderboard: QuizLeaderboard | null) {
  return leaderboard?.entries ?? [];
}

function ParticipantCount({
  count,
  styles,
}: {
  count: number;
  styles: ReturnType<typeof createQuizLeaderboardStyles>;
}) {
  return (
    <Text style={styles.participantCount}>
      {count} {count === 1 ? 'participant' : 'participants'}
    </Text>
  );
}

function LeaderboardRow({
  entry,
  styles,
}: {
  entry: QuizLeaderboardEntry;
  styles: ReturnType<typeof createQuizLeaderboardStyles>;
}) {
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
      <Text numberOfLines={1} style={styles.name}>
        {entry.displayName}
      </Text>
      <Text style={styles.score}>{entry.score} pts</Text>
    </View>
  );
}

export function QuizLeaderboardScreen() {
  const { colors } = useTheme();
  const styles = createQuizLeaderboardStyles(colors);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [events, setEvents] = useState<QuizEvent[]>([]);
  const [selected, setSelected] = useState<QuizEvent | null>(null);
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const leaderboardRequestId = useRef(0);

  useEffect(() => {
    let active = true;
    fetchQuizEvents()
      .then((items) => {
        if (!active) return;
        setEvents(
          items.filter((item) =>
            ['completed', 'closed', 'cancelled'].includes(item.status)
          )
        );
      })
      .catch(() => active && setError('Past leaderboards are unavailable.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const loadLeaderboard = async (event: QuizEvent) => {
    const requestId = ++leaderboardRequestId.current;
    setSelected(event);
    setLeaderboard(null);
    setError(null);
    if (!userId) {
      setError('Sign in to view quiz leaderboards.');
      return;
    }
    setLoading(true);
    try {
      const result = await fetchQuizLeaderboard({
        eventId: event.id,
        expectedUserId: userId,
      });
      if (requestId === leaderboardRequestId.current) setLeaderboard(result);
    } catch {
      if (requestId === leaderboardRequestId.current)
        setError('This leaderboard is not available yet.');
    } finally {
      if (requestId === leaderboardRequestId.current) setLoading(false);
    }
  };

  const rows = getLeaderboardRows(leaderboard);

  if (selected) {
    return (
      <View style={styles.screen}>
        <FlatList
          contentContainerStyle={styles.content}
          data={rows}
          keyExtractor={(entry) => `${entry.rank}-${entry.displayName}`}
          ListHeaderComponent={
            <View style={styles.boardHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose another quiz"
                onPress={() => {
                  leaderboardRequestId.current += 1;
                  setSelected(null);
                  setLeaderboard(null);
                  setError(null);
                }}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>‹ Past quizzes</Text>
              </Pressable>
              <Text accessibilityRole="header" style={styles.selectedTitle}>
                {selected.title}
              </Text>
              <Text style={styles.selectedMeta}>
                {selected.prizeName} · closed{' '}
                {formatQuizClock(selected.endsAt, undefined, selected.timeZone)}
              </Text>
              {leaderboard?.status === 'published' &&
              leaderboard.participantCount != null ? (
                <ParticipantCount
                  count={leaderboard.participantCount}
                  styles={styles}
                />
              ) : null}
              {leaderboard?.currentPlayer &&
              !leaderboard.entries.some((entry) => entry.isCurrentCustomer) ? (
                <View style={styles.yourRankCard}>
                  <Text style={styles.yourRankLabel}>YOUR RANK</Text>
                  <Text style={styles.yourRankValue}>
                    #{leaderboard.currentPlayer.rank} ·{' '}
                    {leaderboard.currentPlayer.displayName} ·{' '}
                    {leaderboard.currentPlayer.score} pts
                  </Text>
                </View>
              ) : null}
              {loading ? (
                <ActivityIndicator accessibilityLabel="Loading quiz leaderboard" />
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
              {leaderboard?.status === 'published' ? (
                <Text style={styles.boardTitle}>Final standings</Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            loading || error ? null : (
              <Text style={styles.state}>No standings are available yet.</Text>
            )
          }
          renderItem={({ item }) => (
            <LeaderboardRow entry={item} styles={styles} />
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={events}
        keyExtractor={(event) => event.id}
        ListHeaderComponent={
          <View style={styles.historyHeader}>
            <Text style={styles.intro}>
              Choose a previous quiz to see the final standings.
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator accessibilityLabel="Loading past quiz leaderboards" />
          ) : error ? null : (
            <Text style={styles.state}>No previous quiz leaderboards yet.</Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`View leaderboard for ${item.title}`}
            accessibilityRole="button"
            onPress={() => void loadLeaderboard(item)}
            style={styles.eventButton}
          >
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.eventMeta}>
              {item.prizeName} · closed{' '}
              {formatQuizClock(item.endsAt, undefined, item.timeZone)}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
