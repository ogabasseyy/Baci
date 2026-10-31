'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { asRoute } from '@/lib/routes';
import type {
  QuizAttemptResponse,
  QuizEventResponse,
  QuizResultResponse,
} from '@/schemas/quiz';
import { QUIZ_AGE_RESTRICTED_MESSAGE } from '@/schemas/quiz-age-gate-message';
import { formatQuizDateRange } from './format-quiz-date-range';
import { getQuizErrorMessage } from './get-quiz-error-message';
import { QuizAgeGateModal } from './quiz-age-gate-modal';
import { QuizPlayInAppPanel } from './quiz-play-in-app-panel';
import { getQuizStartButtonText } from './get-quiz-start-button-text';
import {
  loadQuizEvents,
  QUIZ_FORFEIT_ANSWER,
  type QuizStatus,
  submitQuizAnswer,
} from './quiz-page-data';
import { QuizQuestionPanel } from './quiz-question-panel';
import { QuizResultPanel } from './quiz-result-panel';
import { useAppQuizEvents } from './use-app-quiz-events';
import { useQuizAgeGate } from './use-quiz-age-gate';
import { useQuizAttemptStart } from './use-quiz-attempt-start';
import {
  quizPanel as panel,
  quizPrimaryButton as primaryButton,
  quizSecondaryButton as secondaryButton,
} from './quiz-styles';

type OgabasseyV2QuizProps = { merchantSlug: string };

export function OgabasseyV2Quiz({ merchantSlug }: OgabasseyV2QuizProps) {
  const pathname = usePathname();
  const { customer, user, isAuthenticated, isLoading, updateCustomer } =
    useCustomerAuth();
  const [status, setStatus] = useState<QuizStatus>('idle');
  const [events, setEvents] = useState<QuizEventResponse[]>([]);
  const [attempt, setAttempt] = useState<QuizAttemptResponse | null>(null);
  const [result, setResult] = useState<QuizResultResponse | null>(null);
  // Captured at start so the result view can load this event's leaderboard —
  // `attempt` is cleared when the attempt completes.
  const [playedEventId, setPlayedEventId] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Synchronous in-flight guards (FIX D): async state (`status`) updates on the
  // next render, so a fast physical double-tap can fire two requests before the
  // button disables. The server does NOT dedupe start — each call burns one of
  // the player's limited attempts (QZ030 cap) — so guard synchronously.
  const submitInFlightRef = useRef(false);
  const routePrefix = pathname?.startsWith(`/${merchantSlug}`) ? `/${merchantSlug}` : '';
  const quizPath = pathname || `${routePrefix}/quiz`;
  const loginHref = `${routePrefix}/account/login?redirect=${encodeURIComponent(quizPath)}`;

  // Current prize quizzes are app-only; the web lists them with app links and
  // keeps the legacy web flow only for quizzes the app listing does not cover.
  const appEvents = useAppQuizEvents(
    merchantSlug,
    !isLoading && isAuthenticated ? (user?.id ?? customer?.id ?? null) : null
  );
  const appEventIds = new Set(appEvents.map((event) => event.id));
  const webEvents = events.filter((event) => !appEventIds.has(event.id));

  const loadEvents = () =>
    loadQuizEvents(merchantSlug, { setError, setEvents, setStatus });

  useEffect(() => {
    if (!isLoading && isAuthenticated && status === 'idle') void loadEvents();
    // biome-ignore lint/correctness/useExhaustiveDependencies: loadEvents intentionally runs only when auth becomes ready
  }, [isAuthenticated, isLoading, merchantSlug, status]);

  // Starts a quiz attempt and commits it into page state. Returns the
  // shopper-facing error on failure (so the age gate can stay open with the
  // message) or null on success. Owns the double-tap guard and the
  // account-switch identity guard; see use-quiz-attempt-start.
  const runStart = useQuizAttemptStart({
    currentUserId: user?.id ?? null,
    setAttempt,
    setError,
    setPlayedEventId,
    setResult,
    setSelectedAnswer,
    setStatus,
  });

  // Super Quiz is 18+. When the customer has no date of birth on file, the start
  // is deferred behind this gate (which owns its own concurrency safety) until
  // they provide one; see use-quiz-age-gate.
  const ageGate = useQuizAgeGate({
    runStart,
    updateCustomer,
    clearStartError: () => setError(null),
    // Bind a deferred start to the current shopper (by auth user id, matching
    // the server's expected_user_id gate) so an account switch while the DOB
    // save/start is in flight can't act under the new shopper's session.
    currentCustomerId: user?.id ?? null,
  });

  const handleStart = async (event: QuizEventResponse) => {
    // The server age gate (production) needs a date of birth on the customer
    // profile; collect it once here before starting, otherwise start straight.
    if (customer && !customer.date_of_birth) {
      ageGate.open(event);
      return;
    }
    const startError = await runStart(event);
    // A stored DOB can still fail the server age gate (an adult mistyped it, so
    // it saved but reads as under-18). The gate is the only DOB editor, and a
    // rejected start never consumes an attempt, so reopen it with the reason
    // instead of stranding the shopper behind the now-non-empty date_of_birth.
    if (startError === QUIZ_AGE_RESTRICTED_MESSAGE) {
      setError(null);
      ageGate.open(event, startError);
    }
  };

  const submitAnswer = async (answer: string) => {
    if (!attempt || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setError(null);
    setStatus('submitting');
    try {
      const nextResult = await submitQuizAnswer(
        attempt.attemptId,
        attempt.question.id,
        answer
      );
      setResult(nextResult);
      if (nextResult.status === 'in_progress' && nextResult.question) {
        setAttempt({ ...attempt, question: nextResult.question });
        setSelectedAnswer(null);
        setStatus('question');
      } else {
        setAttempt(null);
        setSelectedAnswer(null);
        setStatus('result');
      }
    } catch (error) {
      setError(getQuizErrorMessage(error));
      // Keep a failed timeout submission retryable. Without the sentinel in
      // state, the question returns with no selected answer and the player
      // has no way to retry the request after the timer has already fired.
      if (answer === QUIZ_FORFEIT_ANSWER) {
        setSelectedAnswer(QUIZ_FORFEIT_ANSWER);
      }
      setStatus('question');
    } finally {
      submitInFlightRef.current = false;
    }
  };

  const handleSubmit = () => {
    if (!selectedAnswer) return;
    void submitAnswer(selectedAnswer);
  };

  // FIX A: the countdown fires this at expiry. Submit the selected option, or a
  // forfeit sentinel if none is picked, so the attempt always advances.
  const handleAutoSubmit = () => {
    if (!attempt || status !== 'question') return;
    void submitAnswer(selectedAnswer ?? QUIZ_FORFEIT_ANSWER);
  };

  return (
    <main className="min-h-[70vh] bg-store-background px-4 py-8 text-store-background-text sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <section className={`${panel} sm:p-6`}>
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase text-store-primary">Ogabassey rewards</p>
              <h1 className="mt-2 text-3xl font-bold tracking-normal text-store-background-text sm:text-4xl">Super Quiz</h1>
              <p className="mt-3 text-sm leading-6 text-store-background-text/70">
                Free to enter — answer each timed question and qualify for prize
                rewards. No purchase necessary.
              </p>
            </div>
            <div className="rounded-lg border border-store-primary/20 bg-store-primary/5 p-4">
              <p className="text-sm font-semibold">Entry</p>
              <p className="mt-1 text-2xl font-bold text-store-primary">Free</p>
              <p className="text-xs text-store-background-text/60">No loyalty points required</p>
            </div>
          </div>
        </section>

        {isLoading ? null : <QuizPlayInAppPanel events={appEvents} />}

        {isLoading ? (
          <section aria-live="polite" className={panel}>Checking your quiz access…</section>
        ) : null}

        {!isLoading && !isAuthenticated ? (
          <section className={panel}>
            <h2 className="text-lg font-semibold">Sign in to play</h2>
            <p className="mt-2 text-sm leading-6 text-store-background-text/70">
              Super Quiz is free to play for anyone with an Ogabassey account.
              Creating one is free — no purchase necessary.
            </p>
            <Link href={asRoute(loginHref)} className={`mt-4 inline-flex items-center justify-center ${primaryButton}`}>Sign in</Link>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</p>
        ) : null}

        {isAuthenticated && (status === 'loading' || status === 'idle') ? (
          <section aria-live="polite" className={panel}>Loading quiz events…</section>
        ) : null}

        {isAuthenticated && status === 'error' ? (
          <button type="button" onClick={() => void loadEvents()} className={`w-fit ${secondaryButton}`}>Try again</button>
        ) : null}

        {isAuthenticated &&
        (status === 'ready' || status === 'starting') &&
        webEvents.length > 0 ? (
          <section aria-label="Available quiz events" className="grid gap-4 md:grid-cols-2">
            {webEvents.map((event) => {
              const disabled = status === 'starting' || event.status !== 'open';
              return (
                <article key={event.id} className={panel}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">{event.title}</h2>
                      <p className="mt-1 text-sm font-medium text-store-primary">{event.prizeName}</p>
                    </div>
                    <span className="rounded-full bg-store-primary/10 px-3 py-1 text-xs font-semibold text-store-primary">{event.status}</span>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-store-background-text/70">
                    {event.questionCount} questions. {formatQuizDateRange(event)}.
                  </p>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${getQuizStartButtonText(event, status === 'starting')} for ${event.title}`}
                    onClick={() => void handleStart(event)}
                    className={`mt-5 w-full ${primaryButton}`}
                  >
                    {getQuizStartButtonText(event, status === 'starting')}
                  </button>
                </article>
              );
            })}
          </section>
        ) : null}

        {(status === 'question' || status === 'submitting') && attempt ? (
          <QuizQuestionPanel
            key={attempt.question.id}
            attempt={attempt}
            isSubmitting={status === 'submitting'}
            onAutoSubmit={handleAutoSubmit}
            onSelect={setSelectedAnswer}
            onSubmit={handleSubmit}
            selectedAnswer={selectedAnswer}
          />
        ) : null}

        {status === 'result' && result ? (
          <QuizResultPanel
            eventId={playedEventId}
            onBackToQuizzes={() => void loadEvents()}
            result={result}
          />
        ) : null}
      </div>

      <QuizAgeGateModal
        disableSubmit={ageGate.savePending}
        onCancel={ageGate.cancel}
        onSubmit={(dateOfBirth) => void ageGate.submit(dateOfBirth)}
        open={ageGate.event !== null}
        serverError={ageGate.error}
        submitting={ageGate.submitting}
      />
    </main>
  );
}
