import { getQuizDeviceFingerprint } from '@/lib/get-quiz-device-fingerprint';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
import { useQuizStore } from '@/stores/quiz-store';
import {
  type QuizBackHandlerRef,
  useQuizBackHandler,
} from './useQuizBackHandler';

interface Options {
  backHandlerRef?: QuizBackHandlerRef;
  dismissRecovery: (eventId: string) => void;
  userId: string | null;
}

export function useQuizLobbyNavigation({
  backHandlerRef,
  dismissRecovery,
  userId,
}: Options) {
  const status = useQuizStore((state) => state.status);
  const v2Attempt = useQuizStore((state) => state.v2Attempt);
  const lifecycle = useQuizStore((state) => state.v2LifecycleStatus);
  const attempt = useQuizStore((state) => state.attempt);
  const pendingStartEventId = useQuizStore((state) =>
    userId &&
    state.recoveryUserId === userId &&
    state.startRequestId &&
    state.v2LifecycleStatus === 'idle'
      ? state.selectedEventId
      : null
  );
  const resumeEventId =
    v2Attempt?.status === 'in_progress' && lifecycle === 'in_progress'
      ? v2Attempt.eventId
      : !v2Attempt
        ? (attempt?.eventId ?? pendingStartEventId)
        : null;
  useQuizBackHandler(
    backHandlerRef,
    status === 'result'
      ? null
      : () => {
          const state = useQuizStore.getState();
          if (state.selectedEventId) dismissRecovery(state.selectedEventId);
          state.showLobby();
        }
  );
  const onResume = async (eventId: string) => {
    if (!userId || eventId !== resumeEventId) return;
    const state = useQuizStore.getState();
    if (state.status !== 'ready') return;
    if (!state.v2Attempt && state.attempt?.eventId === eventId) {
      useQuizStore.setState({ status: 'question', error: null });
      return;
    }
    if (state.v2Attempt && state.v2Attempt.eventId !== eventId) return;
    await state.recoverEvent(
      userId,
      eventId,
      async () => {
        const deviceFingerprint = await getQuizDeviceFingerprint().catch(
          () => null
        );
        return recoverActiveQuizAttempt({
          eventId,
          expectedUserId: userId,
          deviceFingerprint,
        });
      },
      (answer, questionId) => {
        // Recovery installs the authoritative attempt before resending an answer.
        const recoveredAttempt = useQuizStore.getState().v2Attempt;
        if (!recoveredAttempt || recoveredAttempt.eventId !== eventId)
          throw new Error('Quiz attempt is not available for answer recovery.');
        return submitQuizAnswerV2({
          answer,
          questionId,
          attemptId: recoveredAttempt.attemptId,
          expectedUserId: userId,
          clientAnsweredAt: new Date().toISOString(),
        });
      }
    );
  };
  return { onResume, resumeEventId };
}
