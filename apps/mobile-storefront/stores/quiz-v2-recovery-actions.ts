import type {
  QuizActiveAttemptResponse,
  QuizV2Attempt,
} from '@/services/quiz-types';
import { clearRecoveredQuizAttempt } from './quiz-v2-recovery-storage';
import { isQuizOpenAtServerTime } from './quiz-v2-server-clock';
import type { QuizV2StoreAccess } from './quiz-v2-store-access';
import { createQuizTerminalContext } from './quiz-v2-terminal-context';

export function createQuizV2RecoveryResponseApplier({
  access,
  apply,
}: {
  access: QuizV2StoreAccess;
  apply: (attempt: QuizV2Attempt) => Promise<void>;
}) {
  return async (
    response: QuizActiveAttemptResponse,
    fallback: QuizV2Attempt
  ) => {
    if (
      response.availability === 'active' &&
      response.attempt &&
      isQuizOpenAtServerTime(response)
    ) {
      await apply(response.attempt);
      return;
    }
    if (response.availability === 'none') {
      access.set({
        status: 'question',
        v2Attempt: fallback,
        expiryRetryable: true,
        error: null,
      });
      return;
    }
    if (response.availability === 'unavailable') {
      access.set({
        status: 'result',
        v2Attempt: null,
        v2LifecycleStatus: 'final',
        v2Result: {
          attemptId: response.attemptId ?? fallback.attemptId,
          availability: 'unavailable',
          reason: 'not_found',
        },
        terminalContext: createQuizTerminalContext(
          response.attemptId ?? fallback.attemptId,
          fallback.eventId,
          response.eventEndsAt ?? fallback.eventEndsAt,
          response.serverNow ?? fallback.serverNow,
          null
        ),
        lockedOptionId: null,
        expiryRetryable: false,
        error: null,
      });
      await clearRecoveredQuizAttempt(access, fallback.eventId).catch(
        () => undefined
      );
      return;
    }
    const expiredActive =
      response.availability === 'active' && response.attempt;
    const terminal =
      expiredActive ||
      response.availability === 'pending_results' ||
      response.availability === 'cancelled';
    if (!terminal) return;
    access.set({
      status: 'result',
      v2Attempt: null,
      v2LifecycleStatus:
        response.availability === 'cancelled'
          ? 'event_cancelled'
          : 'pending_results',
      terminalContext: createQuizTerminalContext(
        fallback.attemptId,
        fallback.eventId,
        response.eventEndsAt ?? fallback.eventEndsAt,
        response.serverNow ?? fallback.serverNow,
        response.submittedAt ?? null
      ),
      lockedOptionId: null,
      expiryRetryable: false,
      error: null,
    });
    if (response.availability === 'cancelled') {
      await clearRecoveredQuizAttempt(access, fallback.eventId).catch(
        () => undefined
      );
    }
  };
}
