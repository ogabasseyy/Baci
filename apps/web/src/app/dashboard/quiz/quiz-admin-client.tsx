'use client';

import { getQuizLaunchPolicy } from '@baci/shared/constants';
import { useState } from 'react';
import type { MerchantQuizGenerationResponse } from '@/schemas/quiz';
import type { QuizPrizeProduct } from '@/schemas/quiz-prize-product';
import {
  activateQuizEvent,
  generateQuizDraft,
  type QuizAnswerKeyReview,
  type QuizDraftConfiguration,
  type QuizLaunchInput,
} from './quiz-admin-actions';
import { QuizAdminResult } from './quiz-admin-result';
import { QuizAuthoringForm } from './quiz-authoring-form';
import { quizDatetimeLocalToIso } from './quiz-datetime-local';

export function QuizAdminClient({
  initialPrizeProducts,
  initialPrizeProductsError = null,
}: {
  initialPrizeProducts: QuizPrizeProduct[];
  initialPrizeProductsError?: string | null;
}) {
  const [result, setResult] = useState<MerchantQuizGenerationResponse | null>(
    null
  );
  const [configuration, setConfiguration] =
    useState<QuizDraftConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  const generate = (next: QuizDraftConfiguration) => {
    setError(null);
    setActivationError(null);
    setResult(null);
    setConfiguration(next);
    setIsGenerating(true);
    generateQuizDraft({
      difficulty: next.difficulty,
      mode: next.mode,
      prizeProduct: next.prizeProduct,
      questionCountPerTopic: next.questionCountPerTopic,
      timeLimitSeconds: next.timePerQuestionSeconds,
      title: next.title,
      topics: next.topics,
    })
      .then(setResult)
      .catch((cause: unknown) => {
        setConfiguration(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'Failed to generate quiz draft'
        );
      })
      .finally(() => setIsGenerating(false));
  };

  const activate = (
    answerKeyReview: QuizAnswerKeyReview,
    regulatoryCompliance?: QuizLaunchInput['regulatoryCompliance']
  ) => {
    if (!result || !configuration) return;
    const eventId = result.event.id;
    const launchPolicy = getQuizLaunchPolicy(configuration.mode);
    setActivationError(null);
    let timing:
      | { kind: 'immediate'; liveWindowSeconds: number }
      | { kind: 'scheduled'; startsAt: string; endsAt: string };
    if (configuration.timingKind === 'scheduled') {
      const startsAt = quizDatetimeLocalToIso(
        configuration.scheduledStart,
        launchPolicy.timeZone
      );
      const endsAt = quizDatetimeLocalToIso(
        configuration.scheduledEnd,
        launchPolicy.timeZone
      );
      if (
        !startsAt ||
        !endsAt ||
        Date.parse(startsAt) <= Date.now() ||
        Date.parse(endsAt) <= Date.parse(startsAt)
      ) {
        setActivationError(
          'Choose a valid future start and an end time after it.'
        );
        return;
      }
      timing = {
        endsAt,
        kind: 'scheduled',
        startsAt,
      };
    } else {
      timing = {
        kind: 'immediate',
        liveWindowSeconds: configuration.liveWindowMinutes * 60,
      };
    }
    setIsActivating(true);
    activateQuizEvent(eventId, answerKeyReview, {
      maxAttempts: launchPolicy.maxAttempts,
      mode: configuration.mode,
      ...(regulatoryCompliance ? { regulatoryCompliance } : {}),
      rulesVersion: launchPolicy.rulesVersion,
      timePerQuestionSeconds: configuration.timePerQuestionSeconds,
      timeZone: launchPolicy.timeZone,
      timing,
      variantsPerQuestion: launchPolicy.variantsPerQuestion,
    })
      .then((data) =>
        setResult((current) =>
          current?.event.id === eventId
            ? { ...current, event: data.event }
            : current
        )
      )
      .catch((cause: unknown) =>
        setActivationError(
          cause instanceof Error ? cause.message : 'Failed to launch quiz'
        )
      )
      .finally(() => setIsActivating(false));
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">
          Gemma quiz generation
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Quiz</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a draft, review every answer, then launch or schedule the quiz.
        </p>
      </header>
      <QuizAuthoringForm
        disabled={isActivating}
        initialError={initialPrizeProductsError}
        initialProducts={initialPrizeProducts}
        isGenerating={isGenerating}
        onGenerate={generate}
      />
      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {result && configuration ? (
        <QuizAdminResult
          activationError={activationError}
          configuration={configuration}
          isActivating={isActivating}
          onActivate={activate}
          result={result}
        />
      ) : null}
    </div>
  );
}
