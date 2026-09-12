import type { QuizV2Attempt } from '@/services/quiz-types';
import { clearRecoveredQuizAttempt } from './quiz-v2-recovery-storage';
import type { QuizV2StoreAccess } from './quiz-v2-store-access';
import { createQuizTerminalContext } from './quiz-v2-terminal-context';

type PersistAttempt = (
  attempt: QuizV2Attempt,
  lockedOptionId: string | null
) => Promise<void>;

export function createQuizV2AttemptApplier({
  access,
  persist,
}: {
  access: QuizV2StoreAccess;
  persist: PersistAttempt;
}) {
  return async (attempt: QuizV2Attempt) => {
    if (attempt.status === 'in_progress') {
      access.set({
        status: 'question',
        v2Attempt: attempt,
        v2LifecycleStatus: 'in_progress',
        lockedOptionId: null,
        terminalContext: null,
        expiryRetryable: false,
        error: null,
      });
      await persist(attempt, null).catch(() => undefined);
      return;
    }

    access.set({
      status: 'result',
      v2Attempt: null,
      v2LifecycleStatus:
        attempt.status === 'event_cancelled'
          ? 'event_cancelled'
          : 'pending_results',
      terminalContext: createQuizTerminalContext(
        attempt.attemptId,
        attempt.eventId,
        attempt.eventEndsAt,
        attempt.serverNow,
        attempt.submittedAt ?? null
      ),
      lockedOptionId: null,
      expiryRetryable: false,
      error: null,
    });
    await persist(attempt, null).catch(() => undefined);
    if (attempt.status === 'event_cancelled') {
      await clearRecoveredQuizAttempt(access, attempt.eventId).catch(
        () => undefined
      );
    }
  };
}
