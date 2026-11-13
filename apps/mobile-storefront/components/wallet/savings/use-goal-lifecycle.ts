import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@/lib/config';
import {
  checkGoalActionStatus,
  issueGoalAction,
  submitGoalAction,
} from '@/lib/goal-lifecycle-api';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { isPinCancelled, runWithPinProof } from '@/lib/wallet-pin-proof';
import type { GoalActionKind } from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import {
  codeOf,
  GOAL_LIFECYCLE_COPY,
  type GoalLifecycleStep,
  messageOf,
  NOT_STARTABLE_CODES,
  type Outcome,
  REVIEW,
  submitFailure,
} from './goal-lifecycle-outcomes';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';

export type { GoalLifecycleStep };
export { GOAL_LIFECYCLE_COPY };

const POLL_MS = 5000;
const MAX_WAITS = 24; // 24 x 5 s = the two minutes we poll for

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * State machine for cancelling or completing a goal behind a wallet PIN:
 * review -> issuing -> pin -> submitting -> polling -> done / failed /
 * needs_review. The server's operation id is kept for the life of the
 * attempt, a submit is sent at most once per proof prompt, and an
 * indeterminate submit is only ever followed by status reads.
 */
export function useGoalLifecycle({
  kind,
  goalId,
  resetKey = 0,
}: {
  kind: GoalActionKind;
  goalId: string;
  resetKey?: number; // a new value starts a fresh attempt
}) {
  const userId = useAuthStore((state) => state.user?.id);
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID);
  const { requestProof, sheetProps, takeInvalid, cancel } =
    useWalletPinPrompt();
  const [outcome, setOutcome] = useState<Outcome>(REVIEW);
  const operationRef = useRef<string | null>(null);
  const busy = useRef(false);
  // Whether a submit has been sent for the current operation: a status read
  // that says "not started" after one cannot prove nothing will happen.
  const submitted = useRef(false);
  const generation = useRef(0);

  // A new account, goal, kind or attempt never inherits an earlier outcome.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope is the trigger, the body reads none of it.
  useEffect(() => {
    generation.current += 1;
    operationRef.current = null;
    submitted.current = false;
    busy.current = false;
    // A sheet left open for the previous goal or action must not linger.
    cancel();
    setOutcome(REVIEW);
    return () => {
      generation.current += 1;
    };
  }, [userId, merchantId, goalId, kind, resetKey]);

  const show = (
    step: GoalLifecycleStep,
    message: string | null = null,
    canStartAgain = false,
    needsSignIn = false
  ) => setOutcome({ step, message, canStartAgain, needsSignIn });

  const poll = async (operationId: string, isCurrent: () => boolean) => {
    if (!merchantId) return;
    show('polling');
    for (let wait = 0; wait <= MAX_WAITS; wait += 1) {
      if (wait > 0) await sleep(POLL_MS);
      if (!isCurrent()) return;
      try {
        const reply = await checkGoalActionStatus(
          kind,
          { merchantId, operationId },
          userId
        );
        if (!isCurrent()) return;
        if (reply.status === 'confirmed') return show('done');
        if (reply.status === 'needs_review')
          return show('needs_review', GOAL_LIFECYCLE_COPY.needsReview);
        // After a submit went out, the server may still be about to claim
        // it: keep reading rather than claim nothing changed.
        if (reply.status === 'not_started' && !submitted.current)
          return show('failed', GOAL_LIFECYCLE_COPY.nothingChanged, true);
      } catch (error) {
        if (!isCurrent()) return;
        const code = codeOf(error);
        // A status read cannot confirm the outcome: offer sign-in without
        // saying nothing changed.
        if (code === 'UNAUTHORIZED')
          return show('timed_out', null, false, true);
        if (code === `${kind.toUpperCase()}_NOT_FOUND`)
          return show('failed', messageOf(error), true);
        // The server's final word: nothing moved. Anything else (a network
        // error, a timeout, another refusal) stays indeterminate.
        if (code === `${kind.toUpperCase()}_REJECTED`)
          return show('failed', GOAL_LIFECYCLE_COPY[kind].rejected);
      }
    }
    show('timed_out');
  };

  const askPinAndSubmit = async (
    operationId: string,
    isCurrent: () => boolean
  ) => {
    if (!merchantId) return;
    const request = { action: kind, merchantId, goalId, operationId } as const;
    show('pin');
    const first = await requestProof(request);
    if (!isCurrent()) return;
    if (!first) {
      const invalid = takeInvalid();
      return invalid ? show('failed', invalid, true) : show('pin_cancelled');
    }
    show('submitting');
    submitted.current = true;
    let seed: string | undefined = first;
    try {
      const reply = await runWithPinProof(
        (proof) => {
          // A superseded attempt must never send (or re-send) anything.
          if (!isCurrent())
            throw Object.assign(new Error('Attempt superseded'), {
              code: 'ATTEMPT_SUPERSEDED',
            });
          const pinProof = proof ?? seed;
          seed = undefined;
          if (!pinProof)
            throw Object.assign(new Error('PIN required'), {
              code: 'PIN_PROOF_REQUIRED',
            });
          return submitGoalAction(
            kind,
            { merchantId, goalId, operationId, pinProof },
            userId
          );
        },
        request,
        async (again) => {
          // Never reopen a sheet for a goal or action no longer on screen.
          if (!isCurrent()) return null;
          show('pin');
          const proof = await requestProof(again);
          if (proof) show('submitting');
          return proof;
        }
      );
      if (!isCurrent()) return;
      if (reply.status === 'confirmed') return show('done');
      await poll(operationId, isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      if (isPinCancelled(error)) {
        const invalid = takeInvalid();
        return invalid ? show('failed', invalid, true) : show('pin_cancelled');
      }
      const definite = submitFailure(kind, error);
      if (definite) return setOutcome(definite);
      await poll(operationId, isCurrent);
    }
  };

  const guarded = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (busy.current) return;
    // A lapsed session offers sign-in; after a submit the outcome is unknown.
    if (!merchantId || !userId)
      return submitted.current
        ? show('timed_out', null, false, true)
        : show('failed', GOAL_LIFECYCLE_COPY.signedOut, false, true);
    const started = generation.current;
    const isCurrent = () => generation.current === started;
    busy.current = true;
    try {
      await work(isCurrent);
    } finally {
      if (isCurrent()) busy.current = false;
    }
  };

  /** Continue / Start again: asks the server for the operation, then goes on. */
  const begin = () =>
    guarded(async (isCurrent) => {
      if (!merchantId) return;
      operationRef.current = null;
      submitted.current = false;
      show('issuing');
      try {
        const issued = await issueGoalAction(
          kind,
          { merchantId, goalId },
          userId
        );
        if (!isCurrent()) return;
        operationRef.current = issued.operationId;
        if (issued.status === 'confirmed') return show('done');
        if (issued.status === 'pending')
          return await poll(issued.operationId, isCurrent);
        await askPinAndSubmit(issued.operationId, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        const code = codeOf(error);
        if (code === 'GOAL_NEEDS_REVIEW')
          return show('needs_review', messageOf(error));
        const final = [
          ...NOT_STARTABLE_CODES,
          `${kind.toUpperCase()}_NOT_ELIGIBLE`,
        ];
        show(
          'failed',
          messageOf(error),
          !(code && final.includes(code)),
          code === 'UNAUTHORIZED'
        );
      }
    });

  const retryPin = () =>
    guarded(async (isCurrent) => {
      const operationId = operationRef.current;
      if (!operationId) return;
      await askPinAndSubmit(operationId, isCurrent);
    });

  const checkAgain = () =>
    guarded(async (isCurrent) => {
      const operationId = operationRef.current;
      if (operationId) await poll(operationId, isCurrent);
    });

  return { ...outcome, begin, retryPin, checkAgain, sheetProps };
}
