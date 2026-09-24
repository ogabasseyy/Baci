import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { QuizResult, QuizV2Result } from '@/services/quiz-types';
import type { QuizV2LifecycleStatus } from '@/stores/quiz-recovery-envelope';
import { useQuizStore } from '@/stores/quiz-store';
import { QuizPrizeClaimPanel } from './QuizPrizeClaimPanel';
import { QuizResultsStandings } from './QuizResultsStandings';
import type { createQuizStyles } from './QuizScreen.styles';
import { useQuizEventTimer } from './use-quiz-event-timer';
import { useQuizResultsLeaderboard } from './use-quiz-results-leaderboard';
import { useQuizServerClock } from './use-quiz-server-clock';

type QuizStyles = ReturnType<typeof createQuizStyles>;

function formatCountdown(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function formatFinishTime(serverNow: string | null | undefined) {
  if (!serverNow) return null;
  const timestamp = Date.parse(serverNow);
  if (Number.isNaN(timestamp)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

interface QuizResultsPanelProps {
  eventId?: string | null;
  eventEndsAt?: string | null;
  expectedUserId?: string | null;
  legacyResult: QuizResult | null;
  lifecycle: QuizV2LifecycleStatus;
  serverNow?: string | null;
  styles: QuizStyles;
  v2Result: QuizV2Result | null;
}

export function QuizResultsPanel({
  eventId = null,
  eventEndsAt = null,
  expectedUserId = null,
  legacyResult,
  lifecycle,
  serverNow = null,
  styles,
  v2Result,
}: QuizResultsPanelProps) {
  const router = useRouter();
  const resetQuiz = useQuizStore((state) => state.reset);
  const { offsetMs } = useQuizServerClock(serverNow);
  const eventTimer = useQuizEventTimer({
    eventEndsAt,
    isActive: false,
    onExpire: () => undefined,
    serverClockOffsetMs: offsetMs,
    ticking: true,
  });
  const shouldLoadLeaderboard =
    (lifecycle === 'final' || lifecycle === 'pending_results') &&
    v2Result?.availability !== 'unavailable' &&
    Boolean(eventId && expectedUserId);
  const { leaderboard, leaderboardError, participantCount } =
    useQuizResultsLeaderboard({
      enabled: shouldLoadLeaderboard,
      eventHasEnded: eventTimer.hasEnded,
      eventId,
      expectedUserId,
      lifecycle,
    });
  const finishTime = formatFinishTime(
    leaderboard?.currentPlayer?.submittedAt ??
      leaderboard?.entries.find((entry) => entry.isCurrentCustomer)?.submittedAt
  );
  if (lifecycle !== 'idle') {
    const isCancelled =
      (v2Result?.availability === 'unavailable' &&
        v2Result.reason === 'event_cancelled') ||
      lifecycle === 'event_cancelled';
    const title =
      v2Result?.availability === 'unavailable'
        ? v2Result.reason === 'tester_revoked'
          ? 'Quiz access ended'
          : isCancelled
            ? 'Quiz cancelled'
            : 'Quiz result unavailable'
        : lifecycle === 'pending_results'
          ? "You're all done!"
          : lifecycle === 'event_cancelled'
            ? 'Quiz cancelled'
            : v2Result?.availability === 'final'
              ? `You placed #${v2Result.rank}`
              : 'Quiz complete';
    return (
      <View accessibilityRole="alert" style={styles.resultCard}>
        <View style={styles.resultIcon}>
          <Ionicons
            name={
              lifecycle === 'pending_results'
                ? 'checkmark-circle-outline'
                : 'trophy-outline'
            }
            size={28}
            color={styles.resultTitle.color}
          />
        </View>
        <Text style={styles.resultTitle}>{title}</Text>
        {v2Result?.availability === 'final' ? (
          <View style={styles.scoreSummary}>
            <Text style={styles.scoreValue}>{v2Result.score}</Text>
            <Text style={styles.scoreLabel}>
              points · {v2Result.totalQuestions} questions
            </Text>
          </View>
        ) : null}
        {v2Result?.availability === 'unavailable' ? (
          <Text style={styles.eventMeta}>
            {v2Result.reason === 'tester_revoked'
              ? 'Your tester access was removed before this result was published.'
              : isCancelled
                ? 'This quiz event was cancelled. Return to the quiz list to join another event.'
                : 'We could not find this quiz attempt. Return to the quiz list and try again.'}
          </Text>
        ) : lifecycle === 'pending_results' ? (
          <View style={styles.finishTimeCard}>
            <Text style={styles.finishTimeLabel}>You finished at</Text>
            <Text style={styles.finishTimeValue}>
              {finishTime ?? 'Recorded'}
            </Text>
            <Text style={styles.finishTimeHint}>
              Finish time will be used as a tie breaker
            </Text>
          </View>
        ) : (
          <Text style={styles.eventMeta}>Your quiz attempt is closed.</Text>
        )}
        {lifecycle === 'pending_results' ? (
          <Text style={styles.leaderboardCountdownLabel}>
            {eventTimer.hasEnded
              ? 'The quiz has closed and final results are being prepared.'
              : 'The leaderboard will appear when the quiz ends in'}
          </Text>
        ) : null}
        {lifecycle === 'pending_results' && !eventTimer.hasEnded ? (
          <Text accessibilityRole="timer" style={styles.leaderboardCountdown}>
            {formatCountdown(eventTimer.remainingSeconds)}
          </Text>
        ) : null}
        {shouldLoadLeaderboard ? (
          <QuizResultsStandings
            leaderboard={leaderboard}
            leaderboardError={leaderboardError}
            participantCount={participantCount}
            styles={styles}
          />
        ) : null}
        {v2Result?.availability === 'final' && v2Result.prizeClaim ? (
          <QuizPrizeClaimPanel
            prizeClaim={v2Result.prizeClaim}
            styles={styles}
          />
        ) : null}
        <View style={styles.resultActionBox}>
          {v2Result?.availability === 'final' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View past quiz leaderboards"
              onPress={() => router.push('/quiz/leaderboards')}
              style={styles.resultAction}
            >
              <Text style={styles.secondaryButtonText}>
                View past leaderboards
              </Text>
              <Ionicons
                name="arrow-forward"
                size={20}
                color={styles.secondaryButtonText.color}
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to quiz events"
            onPress={resetQuiz}
            style={styles.resultAction}
          >
            <Text style={styles.secondaryButtonText}>Back to events</Text>
            <Ionicons
              name="arrow-back"
              size={20}
              color={styles.secondaryButtonText.color}
            />
          </Pressable>
        </View>
      </View>
    );
  }
  if (!legacyResult) return null;
  return (
    <View
      accessibilityLabel={`Quiz result: ${legacyResult.correctAnswers} of ${legacyResult.totalQuestions} correct`}
      accessibilityRole="alert"
      style={[styles.resultCard, { margin: 20 }]}
    >
      <Text style={styles.resultTitle}>Result</Text>
      <Text style={styles.resultScore}>
        {legacyResult.correctAnswers} of {legacyResult.totalQuestions} correct
      </Text>
      {legacyResult.prizeClaim ? (
        <QuizPrizeClaimPanel
          prizeClaim={legacyResult.prizeClaim}
          styles={styles}
        />
      ) : (
        <Text style={styles.eventMeta}>
          {legacyResult.prizeEligible
            ? 'Prize entry recorded'
            : 'Practice result only'}
        </Text>
      )}
      <View style={styles.resultActionBox}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to quiz events"
          onPress={resetQuiz}
          style={styles.resultAction}
        >
          <Text style={styles.secondaryButtonText}>Back to events</Text>
          <Ionicons
            name="arrow-back"
            size={20}
            color={styles.secondaryButtonText.color}
          />
        </Pressable>
      </View>
    </View>
  );
}
