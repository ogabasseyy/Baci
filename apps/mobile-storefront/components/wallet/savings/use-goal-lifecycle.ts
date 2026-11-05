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
import { useWalletPinPrompt } from './use-wallet-pin-prompt';

/**
 * Every sentence the goal cancel / complete flow shows that is not a server
 * message. All of it awaits the owner's written approval.
 */
export const GOAL_LIFECYCLE_COPY = {
  cancel: {
    screenTitle: 'Cancel goal',
    entryButton: 'Cancel goal',
    entryLabel: 'Cancel savings goal',
    reviewTitle: 'Cancel this goal?',
    reviewBody:
      'Your whole goal balance, including any interest, goes back to your main wallet. This goal will be closed.',
    primary: 'Continue',
    secondary: 'Keep goal',
    successTitle: 'Goal cancelled',
    successBody: 'Your money is back in your main wallet.',
  },
  complete: {
    screenTitle: 'Complete goal',
    entryButton: 'Complete goal',
    entryLabel: 'Complete savings goal',
    reviewTitle: 'Complete this goal',
    reviewBody:
      'Your whole goal balance, including any interest, moves to your main wallet and we send your purchase request to the store team. They will contact you to finish your purchase. Nothing is spent or paid out automatically.',
    primary: 'Continue',
    secondary: 'Not now',
    successTitle: 'Goal completed',
    successBody:
      'Your money is in your main wallet and your purchase request has been sent.',
  },
  savedSoFar: 'Saved so far',
  backToWallet: 'Back to wallet',
  pending: 'We are still processing this. You can safely leave this screen.',
  stillProcessing: 'Still processing',
  checkAgain: 'Check again',
  pinCancelled: 'PIN cancelled. Nothing was changed.',
  nothingChanged: 'Nothing was changed.',
  tryAgain: 'Try again',
  startAgain: 'Start again',
  needsReview: 'Your savings are safe. Please do not try again.',
} as const;

export type GoalLifecycleStep =
  | 'review'
  | 'issuing'
  | 'pin'
  | 'submitting'
  | 'polling'
  | 'timed_out'
  | 'pin_cancelled'
  | 'done'
  | 'failed'
  | 'needs_review';

type Outcome = {
  step: GoalLifecycleStep;
  message: string | null;
  canStartAgain: boolean;
};

const POLL_MS = 5000;
const MAX_WAITS = 24; // 24 x 5 s = the two minutes we poll for
const REVIEW: Outcome = { step: 'review', message: null, canStartAgain: false };

const codeOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
const messageOf = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : GOAL_LIFECYCLE_COPY.nothingChanged;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function submitFailure(kind: GoalActionKind, error: unknown): Outcome | null {
  const K = kind.toUpperCase();
  const code = codeOf(error);
  if (code === 'GOAL_NEEDS_REVIEW')
    return {
      step: 'needs_review',
      message: messageOf(error),
      canStartAgain: false,
    };
  const again = [`${K}_EXPIRED`, `${K}_OPERATION_INVALID`, `${K}_BUSY`];
  const final = [
    `${K}_REJECTED`,
    `${K}_NOT_ELIGIBLE`,
    `${K}_CONFLICT`,
    'NOTHING_TO_REFUND',
    'NOTHING_TO_MOVE',
    'AMOUNT_TOO_LARGE',
    'WALLET_UNAVAILABLE',
    'GOAL_NOT_FOUND',
  ];
  if (code && (again.includes(code) || final.includes(code)))
    return {
      step: 'failed',
      message: messageOf(error),
      canStartAgain: again.includes(code),
    };
  // Anything else (a 503 unavailable, a timeout, an unreadable reply) may
  // have moved money: the caller must read status, never resubmit.
  return null;
}

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
}: {
  kind: GoalActionKind;
  goalId: string;
}) {
  const userId = useAuthStore((state) => state.user?.id);
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID);
  const { requestProof, sheetProps, takeInvalid } = useWalletPinPrompt();
  const [outcome, setOutcome] = useState<Outcome>(REVIEW);
  const operationRef = useRef<string | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);

  // A different account, goal or kind never inherits an attempt in flight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the scope is the trigger, the body reads none of it.
  useEffect(() => {
    generation.current += 1;
    operationRef.current = null;
    busy.current = false;
    setOutcome(REVIEW);
    return () => {
      generation.current += 1;
    };
  }, [userId, merchantId, goalId, kind]);

  const show = (
    step: GoalLifecycleStep,
    message: string | null = null,
    canStartAgain = false
  ) => setOutcome({ step, message, canStartAgain });

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
        if (reply.status === 'not_started')
          return show('failed', GOAL_LIFECYCLE_COPY.nothingChanged, true);
      } catch (error) {
        if (!isCurrent()) return;
        if (codeOf(error) === `${kind.toUpperCase()}_NOT_FOUND`)
          return show('failed', messageOf(error), true);
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
    let seed: string | undefined = first;
    try {
      const reply = await runWithPinProof(
        (proof) => {
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
    if (busy.current || !merchantId || !userId) return;
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
          'GOAL_NOT_FOUND',
          'PIGGYVEST_NOT_READY',
          `${kind.toUpperCase()}_NOT_ELIGIBLE`,
        ];
        show('failed', messageOf(error), !(code && final.includes(code)));
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
