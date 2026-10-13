'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  MerchantQuizActivationInput,
  MerchantQuizGenerationResponse,
} from '@/schemas/quiz';
import type {
  QuizDraftConfiguration,
  QuizLaunchInput,
} from './quiz-admin-actions';
import { isQuizAuthoringWindowAllowed } from './quiz-authoring-window-allowed';
import { QuizLaunchDialog } from './quiz-launch-dialog';
import { QuestionReview } from './quiz-question-review';

type AnswerKeyReview = MerchantQuizActivationInput['answerKeyReview'];

export function QuizAdminResult({
  activationError = null,
  configuration,
  isActivating = false,
  onActivate,
  result,
}: {
  activationError?: string | null;
  configuration: QuizDraftConfiguration;
  isActivating?: boolean;
  onActivate?: (
    answerKeyReview: AnswerKeyReview,
    regulatoryCompliance?: QuizLaunchInput['regulatoryCompliance']
  ) => void;
  result: MerchantQuizGenerationResponse;
}) {
  const [hasReviewed, setHasReviewed] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const previousEventId = useRef(result.event.id);
  const isLaunched =
    result.event.status === 'active' || result.event.status === 'scheduled';
  useEffect(() => {
    if (previousEventId.current === result.event.id) return;
    previousEventId.current = result.event.id;
    setHasReviewed(false);
    setShowDialog(false);
  }, [result.event.id]);
  useEffect(() => {
    if (isLaunched) setShowDialog(false);
  }, [isLaunched]);
  const questions = result.questions.map((question, index) => ({
    key: `${question.topic}:${question.prompt}:${index}`,
    position: index + 1,
    question,
  }));
  const answerKeyReview = {
    questions: questions.map(({ position, question }) => ({
      correctOptionId: question.correctOptionId,
      position,
    })),
  };
  // Gemma may return a different count than requested, and activation
  // validates the window against the generated questions — not the request.
  // Revalidate here so immediate windows and manually edited ends that the
  // generate-time resync leaves alone cannot reach the launch action with
  // stale bounds.
  const launchWindowCoversGenerated = isQuizAuthoringWindowAllowed({
    liveWindowMinutes: configuration.liveWindowMinutes,
    mode: configuration.mode,
    questionCount: questions.length,
    scheduledEnd: configuration.scheduledEnd,
    scheduledStart: configuration.scheduledStart,
    timePerQuestionSeconds: configuration.timePerQuestionSeconds,
    timingKind: configuration.timingKind,
  });
  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-primary">
          {isLaunched ? 'Quiz launched' : 'Draft saved'}
        </p>
        <h2 className="text-xl font-semibold">{result.event.title}</h2>
        <p className="text-sm text-muted-foreground">
          Status: {result.event.status}
        </p>
        {!isLaunched ? (
          <p className="text-sm text-muted-foreground">
            Review every answer marked <strong>Correct</strong>, then launch the
            quiz.
          </p>
        ) : null}
      </div>
      <p className="mt-4 text-sm font-medium">
        Questions to review: {questions.length}
      </p>
      <div className="mt-3 grid max-h-[32rem] gap-3 overflow-y-auto rounded-lg border p-3">
        {questions.map(({ key, position, question }) => (
          <QuestionReview key={key} position={position} question={question} />
        ))}
      </div>
      {isLaunched ? (
        <p className="mt-5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {result.event.status === 'scheduled'
            ? 'This quiz is scheduled and will open at its universal start time.'
            : 'This quiz is active and accepting eligible players.'}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-3 border-t pt-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              checked={hasReviewed}
              className="size-4"
              onChange={(event) => setHasReviewed(event.target.checked)}
              type="checkbox"
            />
            I reviewed every correct answer and approve launching this quiz.
          </label>
          {activationError && !showDialog ? (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              {activationError}
            </p>
          ) : null}
          {!launchWindowCoversGenerated ? (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              The {questions.length} generated questions do not fit the
              configured launch window. Update the timing and generate again.
            </p>
          ) : null}
          <button
            className="inline-flex h-11 w-fit items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={
              !hasReviewed ||
              isActivating ||
              !onActivate ||
              !launchWindowCoversGenerated
            }
            onClick={() => setShowDialog(true)}
            type="button"
          >
            Launch quiz
          </button>
        </div>
      )}
      {showDialog && !isLaunched ? (
        <QuizLaunchDialog
          activationError={activationError}
          answerKeyReview={answerKeyReview}
          configuration={configuration}
          isLaunching={isActivating}
          onCancel={() => setShowDialog(false)}
          onConfirm={(review, regulatoryCompliance) =>
            onActivate?.(review, regulatoryCompliance)
          }
        />
      ) : null}
    </section>
  );
}
