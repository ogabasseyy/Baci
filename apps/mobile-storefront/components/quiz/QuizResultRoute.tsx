import type {
  QuizEvent,
  QuizResult,
  QuizV2Result,
} from '@/services/quiz-types';
import type {
  QuizTerminalContext,
  QuizV2LifecycleStatus,
} from '@/stores/quiz-recovery-envelope';
import { QuizResultsPanel } from './QuizResultsPanel';
import type { createQuizStyles } from './QuizScreen.styles';
import { canPlayAnotherQuizAttempt } from './QuizScreen.utils';
import { useQuizEventTimer } from './use-quiz-event-timer';
import { useQuizServerClock } from './use-quiz-server-clock';
import {
  type QuizBackHandlerRef,
  useQuizBackHandler,
} from './useQuizBackHandler';

type QuizStyles = ReturnType<typeof createQuizStyles>;

interface QuizResultRouteProps {
  backHandlerRef?: QuizBackHandlerRef;
  dismissRecovery: (eventId: string) => void;
  events: QuizEvent[];
  expectedUserId: string | null;
  lifecycle: QuizV2LifecycleStatus;
  onReset: () => void;
  onRetryRecovery: () => void;
  result: QuizResult | null;
  styles: QuizStyles;
  terminalContext: QuizTerminalContext | null;
  v2Result: QuizV2Result | null;
}

export function QuizResultRoute({
  backHandlerRef,
  dismissRecovery,
  events,
  expectedUserId,
  lifecycle,
  onReset,
  onRetryRecovery,
  result,
  styles,
  terminalContext,
  v2Result,
}: QuizResultRouteProps) {
  const event = events.find(
    (candidate) => candidate.id === terminalContext?.eventId
  );
  const { offsetMs } = useQuizServerClock(terminalContext?.serverNow ?? null);
  const eventTimer = useQuizEventTimer({
    eventEndsAt: terminalContext?.eventEndsAt ?? event?.endsAt ?? null,
    isActive: false,
    onExpire: () => undefined,
    shouldTick: lifecycle === 'pending_results',
    serverClockOffsetMs: offsetMs,
  });
  const canPlayAgain = canPlayAnotherQuizAttempt(
    event,
    eventTimer.hasEnded
      ? (terminalContext?.eventEndsAt ?? event?.endsAt)
      : terminalContext?.serverNow
  );
  const returnToLobby = () => {
    if (lifecycle === 'pending_results' && !canPlayAgain) return;
    if (terminalContext?.eventId) dismissRecovery(terminalContext.eventId);
    onReset();
    onRetryRecovery();
  };
  useQuizBackHandler(backHandlerRef, returnToLobby);
  return (
    <QuizResultsPanel
      allowPendingResultsExit={canPlayAgain}
      eventId={terminalContext?.eventId}
      eventEndsAt={terminalContext?.eventEndsAt}
      expectedUserId={expectedUserId}
      legacyResult={result}
      lifecycle={lifecycle}
      onReturnToQuizList={returnToLobby}
      serverNow={terminalContext?.serverNow}
      submittedAt={terminalContext?.submittedAt}
      simulatedPrize={
        event?.mode === 'test' &&
        v2Result?.availability === 'final' &&
        v2Result.rank === 1
          ? (event.prizeProduct ?? null)
          : null
      }
      styles={styles}
      v2Result={v2Result}
    />
  );
}
