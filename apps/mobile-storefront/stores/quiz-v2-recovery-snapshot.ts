import type {
  QuizRecoveryEnvelope,
  QuizV2StoreState,
} from './quiz-recovery-envelope';

export function getQuizRecoverySnapshot(
  userId: string,
  eventId: string,
  snapshot: QuizRecoveryEnvelope | undefined,
  state: QuizV2StoreState,
  generation: number
): QuizRecoveryEnvelope | null {
  const attempt = state.v2Attempt;
  if (
    state.recoveryUserId === userId &&
    state.selectedEventId === eventId &&
    attempt?.eventId === eventId &&
    attempt.question &&
    state.lockedOptionId &&
    state.startRequestId
  ) {
    return {
      version: 1,
      userId,
      eventId,
      generation,
      attemptId: attempt.attemptId,
      currentQuestionId: attempt.question.id,
      pendingLockedOptionId: state.lockedOptionId,
      startRequestId: state.startRequestId,
    };
  }
  return snapshot?.userId === userId && snapshot.eventId === eventId
    ? snapshot
    : null;
}
