import { getQuizDeviceFingerprint } from '@/lib/get-quiz-device-fingerprint';
import { recoverActiveQuizAttempt } from '@/services/quiz-attempt-recovery';
import { submitQuizAnswerV2 } from '@/services/quiz-attempts';
import type { QuizV2Attempt } from '@/services/quiz-types';

interface LifecycleHandlerInput {
  attempt: QuizV2Attempt | null;
  lockedOptionId: string | null;
  userId: string | undefined;
  expire: (
    recoverer: () => ReturnType<typeof recoverActiveQuizAttempt>
  ) => void;
  retry: (
    submitter: (answer: string) => ReturnType<typeof submitQuizAnswerV2>
  ) => void;
}

export function createQuizV2LifecycleHandlers(input: LifecycleHandlerInput) {
  return {
    handleExpire: () => {
      if (!input.attempt || !input.userId) return;
      void input.expire(async () =>
        recoverActiveQuizAttempt({
          deviceFingerprint: await getQuizDeviceFingerprint().catch(() => null),
          eventId: input.attempt?.eventId ?? '',
          expectedUserId: input.userId ?? '',
        })
      );
    },
    handleRetry: () => {
      const question = input.attempt?.question;
      if (!input.attempt || !question || !input.lockedOptionId || !input.userId)
        return;
      void input.retry((answer) =>
        submitQuizAnswerV2({
          answer,
          attemptId: input.attempt?.attemptId ?? '',
          clientAnsweredAt: new Date().toISOString(),
          expectedUserId: input.userId ?? '',
          questionId: question.id,
        })
      );
    },
  };
}
