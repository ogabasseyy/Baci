import { useQuizEventTimer } from './use-quiz-event-timer';
import { useQuizServerClock } from './use-quiz-server-clock';

interface QuizMusicStateInput {
  eventEndsAt?: string | null;
  lifecycle: string;
  serverNow?: string | null;
  status: string;
  hasActiveAttempt: boolean;
}

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export function useQuizMusicState(input: QuizMusicStateInput) {
  const { offsetMs } = useQuizServerClock(input.serverNow ?? null);
  const shouldTick =
    Boolean(input.eventEndsAt) &&
    ((input.hasActiveAttempt &&
      (input.status === 'question' || input.status === 'submitting')) ||
      (input.status === 'result' && input.lifecycle === 'pending_results'));
  const timer = useQuizEventTimer({
    eventEndsAt: input.eventEndsAt ?? null,
    isActive: Boolean(input.eventEndsAt),
    onExpire: () => undefined,
    shouldTick,
    serverClockOffsetMs: offsetMs,
  });
  const shouldPlay =
    (input.hasActiveAttempt &&
      (input.status === 'question' || input.status === 'submitting')) ||
    (input.status === 'result' && input.lifecycle === 'pending_results');

  return { gameEndsIn: formatCountdown(timer.remainingSeconds), shouldPlay };
}
