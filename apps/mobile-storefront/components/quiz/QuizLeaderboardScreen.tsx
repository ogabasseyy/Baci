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
import type { QuizEvent, QuizLeaderboard } from '@/services/quiz-types';
import { useAuthStore } from '@/stores/auth-store';
import { QuizLeaderboardParticipantCount } from './QuizLeaderboardParticipantCount';
import { QuizLeaderboardRow } from './QuizLeaderboardRow';
import { createQuizLeaderboardStyles } from './QuizLeaderboardScreen.styles';
import { formatQuizClock } from './QuizScreen.utils';

function getLeaderboardRows(leaderboard: QuizLeaderboard | null) {
  return leaderboard?.entries ?? [];
}

function isPastQuizEvent(item: QuizEvent): boolean {
  // Finalizing events have closed for play but their final standings are not
  // public yet. Keep them out of history until the published board exists.
  if (item.status === 'finalizing') return Boolean(item.resultsPublishedAt);
  if (['completed', 'closed', 'cancelled'].includes(item.status)) return true;
  if (!item.endsAt || !item.serverNow) return false;
  const endsAt = Date.parse(item.endsAt);
  const serverNow = Date.parse(item.serverNow);
  return (
    Number.isFinite(endsAt) && Number.isFinite(serverNow) && endsAt <= serverNow
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
  const previousUserId = useRef(userId);

  useEffect(() => {
    if (previousUserId.current === userId) return;
    previousUserId.current = userId;
    leaderboardRequestId.current += 1;
    setSelected(null);
    setLeaderboard(null);
    setError(null);
  }, [userId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Account changes intentionally reload the past-event history.
  useEffect(() => {
    let active = true;
    setEvents([]);
    setLoading(true);
    setError(null);
    fetchQuizEvents()
      .then((items) => {
        if (!active) return;
        setEvents(items.filter(isPastQuizEvent));
      })
      .catch(() => active && setError('Past leaderboards are unavailable.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [userId]);

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
                <QuizLeaderboardParticipantCount
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
            <QuizLeaderboardRow entry={item} styles={styles} />
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
