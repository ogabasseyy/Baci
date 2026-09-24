import { useEffect, useRef } from 'react';
import { getQuizDeviceFingerprint } from '@/lib/get-quiz-device-fingerprint';
import {
  ensureQuizMobileAdsReady,
  resetQuizMobileAdsAttempt,
} from '@/services/initialize-quiz-mobile-ads';
import {
  type QuizAttempt,
  type QuizEvent,
  type QuizIntegrityTier,
  startQuizAttempt,
} from '@/services/quiz';
import {
  createQuizStartRequestId,
  startQuizAttemptV2,
} from '@/services/quiz-attempts';
import type { QuizV2Attempt } from '@/services/quiz-types';
import { QuizServiceError } from '@/services/quiz-types';
import { useAuthStore } from '@/stores/auth-store';
import { getQuizErrorMessage } from './QuizScreen.utils';
import { useQuizDateOfBirthGate } from './useQuizDateOfBirthGate';
import { useQuizStartGate } from './useQuizStartGate';

// Server error code raised by QuizAgeGateError (route-helpers-guards.ts) when a
// stored date of birth fails the 18+ gate. Detected client-side to reopen the
// correction gate rather than stranding the shopper.
const QUIZ_AGE_RESTRICTED_CODE = 'quiz_age_restricted';
const START_FAILED_FALLBACK = 'Quiz action failed';

function createQuizSessionChangedError(): QuizServiceError {
  return new QuizServiceError(
    'Your session changed. Please try again.',
    'quiz_session_changed',
    409
  );
}

type StartEvent = (
  eventId: string,
  integrityTier: QuizIntegrityTier,
  starter: () => Promise<QuizAttempt>
) => Promise<void>;

type StartEventV2 = (
  context: {
    eventId: string;
    integrityTier: QuizIntegrityTier;
    startRequestId: string;
    userId: string | null;
  },
  starter: (startRequestId: string) => Promise<QuizV2Attempt>
) => Promise<void>;

/**
 * Orchestrates the two first-play gates and the attempt start. A shopper must
 * satisfy BOTH gates before their first play: a public username (their
 * leaderboard name) and a date of birth (SuperQuiz is 18+). The username gate
 * opens first; on success it hands off to the date-of-birth gate, which either
 * opens or proceeds to the actual start. Both gates fall back to the
 * authoritative server start while the customer row is still hydrating.
 *
 * If the server age gate rejects a stored DOB (an adult mistyped it), the DOB
 * gate reopens for correction — it is the only DOB editor and a rejected start
 * creates no attempt.
 */
export function useQuizStartFlow({
  events = [],
  integrityTier,
  startEvent,
  startEventV2,
}: {
  events?: QuizEvent[];
  integrityTier: QuizIntegrityTier;
  startEvent: StartEvent;
  startEventV2?: StartEventV2;
}) {
  // Bridges the declaration cycle: handleStart reopens the DOB gate on an age
  // rejection, but dobGate is created after it. Synced via an effect so the
  // compiler-managed render stays side-effect free.
  const reopenDobForCorrectionRef = useRef<
    ((eventId: string, message: string) => void) | null
  >(null);
  // Rules are explicitly acknowledged in the lobby, before either profile
  // gate can delay the start. Keep that acknowledgement scoped to the event
  // and this mounted flow; never manufacture acceptance for a v2 request.
  const acceptedTermsEventIdsRef = useRef(new Set<string>());

  const startInFlightRef = useRef(false);

  const handleStartInner = async (eventId: string) => {
    resetQuizMobileAdsAttempt();
    await ensureQuizMobileAdsReady().catch(() => undefined);
    const event = events.find((candidate) => candidate.id === eventId);
    if (event?.contractVersion === 2) {
      if (!startEventV2) {
        // Do not fall back to the v1 endpoint when the server declared v2.
        // The legacy store action owns the visible error state without making
        // a network start request.
        await startEvent(eventId, integrityTier, () =>
          Promise.reject(
            new QuizServiceError(
              'This version of the app cannot start this quiz.',
              'QUIZ_CONTRACT_UNSUPPORTED',
              409
            )
          )
        );
        return;
      }
      const startUserId = useAuthStore.getState().user?.id ?? null;
      await startEventV2(
        {
          eventId,
          integrityTier,
          startRequestId: createQuizStartRequestId(),
          userId: startUserId,
        },
        async (startRequestId) => {
          // Keep every v2 failure inside the store-owned async transition.
          // In particular, a signed-out shopper must not create an unhandled
          // rejection before the v2 action can expose its error state.
          if (!startUserId) throw createQuizSessionChangedError();
          if (!event.rulesVersion || !event.mode) {
            throw new QuizServiceError(
              'This quiz is missing required rules information.',
              'QUIZ_CONTRACT_INVALID',
              502
            );
          }
          if (!acceptedTermsEventIdsRef.current.has(eventId)) {
            throw new QuizServiceError(
              'Please read and accept the quiz rules before playing.',
              'QUIZ_TERMS_ACCEPTANCE_REQUIRED',
              409
            );
          }
          const deviceFingerprint = await getQuizDeviceFingerprint().catch(
            () => null
          );
          if (useAuthStore.getState().user?.id !== startUserId) {
            throw createQuizSessionChangedError();
          }
          try {
            return await startQuizAttemptV2({
              acceptedRulesVersion: event.rulesVersion,
              deviceFingerprint,
              eventId,
              expectedUserId: startUserId,
              integrityTier,
              mode: event.mode,
              startRequestId,
              termsAccepted: true,
            });
          } catch (error) {
            if (
              error instanceof QuizServiceError &&
              error.code === QUIZ_AGE_RESTRICTED_CODE &&
              useAuthStore.getState().user?.id === startUserId
            ) {
              reopenDobForCorrectionRef.current?.(
                eventId,
                getQuizErrorMessage(error, START_FAILED_FALLBACK)
              );
            }
            throw error;
          }
        }
      );
      return;
    }
    // startEvent owns the in-flight/error state and swallows starter failures
    // into the store, so the age-gate recovery lives inside the starter (the
    // only place the thrown error is observable).
    await startEvent(eventId, integrityTier, async () => {
      // Snapshot the signed-in shopper BEFORE any await. If the account signs
      // out or switches during the fingerprint lookup or the request, we must
      // not send (or reopen) the start under the new session — the quiz-store
      // generation guard can only discard the response, not undo a server-side
      // start that already spent the new shopper's attempt.
      const startUserId = useAuthStore.getState().user?.id ?? null;
      // Resolve inside the starter so startEvent enters its synchronous
      // in-flight state before this best-effort native lookup can yield.
      const deviceFingerprint = await getQuizDeviceFingerprint().catch(
        () => null
      );
      // Re-verify identity immediately before issuing the request; abort if the
      // shopper changed (or signed out) while the fingerprint was resolving.
      if (
        startUserId === null ||
        useAuthStore.getState().user?.id !== startUserId
      ) {
        throw createQuizSessionChangedError();
      }
      try {
        return await startQuizAttempt({
          deviceFingerprint,
          eventId,
          expectedUserId: startUserId,
          integrityTier,
        });
      } catch (error) {
        // Reopen the gate so the rejected DOB can be corrected — only while the
        // same shopper is still signed in, so a switch during the request can't
        // open this stale event under the new session.
        if (
          error instanceof QuizServiceError &&
          error.code === QUIZ_AGE_RESTRICTED_CODE &&
          useAuthStore.getState().user?.id === startUserId
        ) {
          reopenDobForCorrectionRef.current?.(
            eventId,
            getQuizErrorMessage(error, START_FAILED_FALLBACK)
          );
        }
        throw error;
      }
    });
  };

  const handleStart = async (eventId: string) => {
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    try {
      await handleStartInner(eventId);
    } finally {
      startInFlightRef.current = false;
    }
  };

  const dobGate = useQuizDateOfBirthGate((eventId) => {
    void handleStart(eventId);
  });
  const usernameGate = useQuizStartGate((eventId) => {
    dobGate.requestStart(eventId);
  });

  const requestStart = (eventId: string, termsAccepted?: true) => {
    if (termsAccepted) acceptedTermsEventIdsRef.current.add(eventId);
    usernameGate.requestStart(eventId);
  };

  // Keep the reopen handler reachable from handleStart, which is defined above
  // dobGate to break the declaration cycle.
  useEffect(() => {
    reopenDobForCorrectionRef.current = dobGate.reopenForCorrection;
  });

  return { dobGate, requestStart, usernameGate };
}
