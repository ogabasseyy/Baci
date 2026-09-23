import type { QuizV2Attempt } from '@/services/quiz-types';
import type {
  QuizRecoveryEnvelope,
  V2StartContext,
} from './quiz-recovery-envelope';
import {
  clearQuizRecoveryEnvelope,
  createQuizRecoveryEnvelope,
  saveQuizRecoveryEnvelope,
} from './quiz-recovery-envelope';
import type { QuizV2StoreAccess } from './quiz-v2-store-access';

export async function clearRecoveredQuizAttempt(
  access: QuizV2StoreAccess,
  eventId: string
): Promise<void> {
  const userId = access.get().recoveryUserId;
  if (userId) await clearQuizRecoveryEnvelope(userId, eventId);
}

export async function clearTerminalRecovery(
  access: QuizV2StoreAccess,
  eventId: string,
  shouldClear: boolean
): Promise<void> {
  if (shouldClear) await clearRecoveredQuizAttempt(access, eventId);
}

export function createQuizAttemptPersistence(access: QuizV2StoreAccess) {
  return async (attempt: QuizV2Attempt, lockedOptionId: string | null) => {
    const state = access.get();
    if (!state.recoveryUserId || !state.startRequestId) return;
    await saveQuizRecoveryEnvelope(
      createQuizRecoveryEnvelope({
        attemptId: attempt.attemptId,
        currentQuestionId: attempt.question?.id ?? null,
        eventId: attempt.eventId,
        generation: access.getGeneration(),
        pendingLockedOptionId: lockedOptionId,
        startRequestId: state.startRequestId,
        submittedAt:
          attempt.status === 'in_progress'
            ? null
            : (attempt.submittedAt ?? null),
        userId: state.recoveryUserId,
      })
    );
  };
}

export function saveQuizStartRequest(
  context: V2StartContext,
  generation: number,
  startRequestId: string
): Promise<void> {
  return saveQuizRecoveryEnvelope(
    createQuizRecoveryEnvelope({
      attemptId: null,
      currentQuestionId: null,
      eventId: context.eventId,
      generation,
      pendingLockedOptionId: null,
      startRequestId,
      submittedAt: null,
      userId: context.userId,
    })
  );
}

export function resolveQuizStartRequestId(
  existing: QuizRecoveryEnvelope | null,
  requested: string
): string {
  const retainedTerminal = Boolean(
    existing?.attemptId &&
      !existing.currentQuestionId &&
      !existing.pendingLockedOptionId
  );
  return retainedTerminal ? requested : (existing?.startRequestId ?? requested);
}
