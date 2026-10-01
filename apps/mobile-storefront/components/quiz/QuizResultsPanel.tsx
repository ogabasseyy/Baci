import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type {
  QuizPrizeProduct,
  QuizResult,
  QuizV2Result,
} from '@/services/quiz-types';
import type { QuizV2LifecycleStatus } from '@/stores/quiz-recovery-envelope';
import { QuizPrizeClaimPanel } from './QuizPrizeClaimPanel';
import { QuizResultsActions } from './QuizResultsActions';
import { QuizResultsStandings } from './QuizResultsStandings';
import type { createQuizStyles } from './QuizScreen.styles';
import { QuizTestPrizeSimulationPanel } from './QuizTestPrizeSimulationPanel';
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
  allowPendingResultsExit?: boolean;
  onReturnToQuizList?: () => void;
  serverNow?: string | null;
  submittedAt?: string | null;
  simulatedPrize?: QuizPrizeProduct | null;
  styles: QuizStyles;
  v2Result: QuizV2Result | null;
}

export function QuizResultsPanel({
  eventId = null,
  eventEndsAt = null,
  expectedUserId = null,
  legacyResult,
  lifecycle,
  allowPendingResultsExit = false,
  onReturnToQuizList,
  serverNow = null,
  submittedAt = null,
  simulatedPrize = null,
  styles,
  v2Result,
}: QuizResultsPanelProps) {
  const { offsetMs } = useQuizServerClock(serverNow);
  const eventTimer = useQuizEventTimer({
    eventEndsAt,
    isActive: false,
    onExpire: () => undefined,
    shouldTick: lifecycle === 'pending_results',
    serverClockOffsetMs: offsetMs,
  });
  const shouldLoadLeaderboard =
    lifecycle === 'final' &&
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
  const currentPlayer =
    leaderboard?.currentPlayer ??
    leaderboard?.entries.find((entry) => entry.isCurrentCustomer);
  const finishTime = formatFinishTime(
    currentPlayer?.submittedAt ?? submittedAt ?? serverNow
  );
  if (lifecycle !== 'idle') {
    const canReturnToQuizList = Boolean(
      onReturnToQuizList &&
        (lifecycle !== 'pending_results' || allowPendingResultsExit)
    );
    const title =
      v2Result?.availability === 'unavailable'
        ? v2Result.reason === 'tester_revoked'
          ? 'Quiz access ended'
          : 'Quiz result unavailable'
        : lifecycle === 'pending_results'
          ? "You're all done!"
          : lifecycle === 'event_cancelled'
            ? 'Quiz cancelled'
            : v2Result?.availability === 'final'
              ? `You placed #${v2Result.rank}`
              : 'Quiz complete';
    return (
      <View accessibilityRole="alert" style={styles.resultsLayout}>
        <ScrollView
          contentContainerStyle={styles.resultsScrollContent}
          style={styles.resultsScroll}
          testID="quiz-results-scroll"
        >
          <View style={styles.resultCard}>
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
            ) : null}
            {lifecycle === 'pending_results' ? (
              eventTimer.hasEnded ? (
                <ActivityIndicator
                  accessibilityLabel="Opening final standings"
                  color={styles.finalStandingsTitle.color}
                />
              ) : (
                <Text style={styles.leaderboardCountdownLabel}>
                  The leaderboard will appear when the quiz ends in
                </Text>
              )
            ) : null}
            {lifecycle === 'pending_results' && !eventTimer.hasEnded ? (
              <Text
                accessibilityRole="timer"
                style={styles.leaderboardCountdown}
              >
                {formatCountdown(eventTimer.remainingSeconds)}
              </Text>
            ) : null}
            {lifecycle === 'final' && shouldLoadLeaderboard ? (
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
            ) : v2Result?.availability === 'final' && simulatedPrize ? (
              <QuizTestPrizeSimulationPanel
                prize={simulatedPrize}
                styles={styles}
              />
            ) : null}
          </View>
        </ScrollView>
        <QuizResultsActions
          onReturnToQuizList={
            canReturnToQuizList ? onReturnToQuizList : undefined
          }
          returnLabel={
            lifecycle === 'pending_results' ? 'Play again' : 'Back to quizzes'
          }
          showHistory={v2Result?.availability === 'final'}
          styles={styles}
        />
      </View>
    );
  }
  if (!legacyResult) return null;
  return (
    <View
      accessibilityLabel={`Quiz result: ${legacyResult.correctAnswers} of ${legacyResult.totalQuestions} correct`}
      accessibilityRole="alert"
      style={styles.resultsLayout}
    >
      <ScrollView
        contentContainerStyle={styles.resultsScrollContent}
        style={styles.resultsScroll}
        testID="quiz-results-scroll"
      >
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>Result</Text>
          <Text style={styles.resultScore}>
            {legacyResult.correctAnswers} of {legacyResult.totalQuestions}{' '}
            correct
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
        </View>
      </ScrollView>
      <QuizResultsActions
        onReturnToQuizList={onReturnToQuizList}
        returnLabel="Back to quizzes"
        showHistory={false}
        styles={styles}
      />
    </View>
  );
}
