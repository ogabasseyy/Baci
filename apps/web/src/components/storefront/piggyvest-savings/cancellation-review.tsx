'use client';

import { piggyvestCancellationReviewSchemas as schemas } from '@baci/shared/contracts';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { ThemedButton } from '@/components/themed/themed-button';
import { ThemedCard } from '@/components/themed/themed-card';

type Props = {
  contextKey?: string;
  sessionKey: string | null;
  goalId: string | null;
  operationId: string | null;
  quote: unknown;
  onPrepare: (
    confirmation: z.infer<typeof schemas.confirmation>
  ) => Promise<unknown>;
};
type ReviewState = {
  key: string;
  callback: Props['onPrepare'];
  checked: boolean;
  action: 'idle' | 'pending' | 'prepared' | 'uncertain';
};
function money(value: number) {
  const kobo = BigInt(value);
  return `NGN ${kobo / 100n}.${String(kobo % 100n).padStart(2, '0')}`;
}

export function CancellationReview(props: Props) {
  const parsedGoal = schemas.confirmation.shape.goalId.safeParse(props.goalId);
  const parsedOperation = schemas.confirmation.shape.operationId.safeParse(
    props.operationId
  );
  const goalIdentity = parsedGoal.success
    ? parsedGoal.data.toLowerCase()
    : null;
  const operationIdentity = parsedOperation.success
    ? parsedOperation.data.toLowerCase()
    : null;
  const parsed = schemas.quote.safeParse(props.quote);
  const quote =
    parsed.success &&
    parsed.data.status === 'quote_available' &&
    parsed.data.goalId.toLowerCase() === goalIdentity &&
    typeof props.sessionKey === 'string' &&
    props.sessionKey.trim().length > 0 &&
    props.sessionKey.length <= 1024 &&
    operationIdentity !== null
      ? parsed.data
      : null;
  const key = JSON.stringify([
    props.contextKey,
    props.sessionKey,
    goalIdentity,
    operationIdentity,
    quote
      ? {
          ...quote,
          goalId: quote.goalId.toLowerCase(),
          revisionId: quote.revisionId.toLowerCase(),
        }
      : null,
  ]);
  const [state, setState] = useState<ReviewState>({
    key,
    callback: props.onPrepare,
    checked: false,
    action: 'idle',
  });
  if (state.key !== key || state.callback !== props.onPrepare) {
    setState({
      key,
      callback: props.onPrepare,
      checked: false,
      action: 'idle',
    });
  }
  const attempted = useRef(new Set<string>());
  const operationKey = JSON.stringify([
    props.sessionKey,
    goalIdentity,
    operationIdentity,
  ]);
  const blocked =
    !quote ||
    typeof props.onPrepare !== 'function' ||
    state.action !== 'idle' ||
    attempted.current.has(operationKey);
  async function prepare() {
    if (
      blocked ||
      !state.checked ||
      !quote ||
      attempted.current.has(operationKey)
    )
      return;
    attempted.current.add(operationKey);
    const pending: ReviewState = { ...state, action: 'pending' };
    setState(pending);
    try {
      const input = schemas.confirmation.parse({
        goalId: quote.goalId,
        operationId: props.operationId,
        revisionId: quote.revisionId,
        termsVersion: quote.termsVersion,
        termsHash: quote.termsHash,
        consentVersion: quote.consentVersion,
        principalKobo: quote.principalKobo,
        paidInterestKobo: quote.paidInterestKobo,
        pendingInterestKobo: quote.pendingInterestKobo,
        accepted: true,
      });
      const receipt = schemas.receipt.parse(await props.onPrepare(input));
      const prepared =
        receipt.status === 'prepared' &&
        receipt.goalId.toLowerCase() === input.goalId.toLowerCase() &&
        receipt.operationId.toLowerCase() === input.operationId.toLowerCase();
      setState((latest) =>
        latest === pending
          ? { ...latest, action: prepared ? 'prepared' : 'uncertain' }
          : latest
      );
    } catch {
      setState((latest) =>
        latest === pending ? { ...latest, action: 'uncertain' } : latest
      );
    }
  }
  return (
    <section aria-label="Cancellation preparation review">
      <ThemedCard className="space-y-4 bg-store-background p-4 text-store-background-text">
        <h2>Review cancellation preparation</h2>
        <p>
          Staging only. This does not refund money. Provider dispatch is
          unavailable; interest disposition remains unresolved.
        </p>
        {quote ? (
          <>
            <p>Principal: {money(quote.principalKobo)}</p>
            <p>Paid interest: {money(quote.paidInterestKobo)}</p>
            <p>Pending interest: {money(quote.pendingInterestKobo)}</p>
            <p>Cancellation fee: 0% under policy {quote.consentVersion}.</p>
            <p>
              Paid and pending interest are excluded from the principal quote.
              No interest has been forfeited or released by this screen.
            </p>
            <p>Terms version: {quote.termsVersion}</p>
            <p className="break-all">Terms hash: {quote.termsHash}</p>
            <label>
              <input
                type="checkbox"
                checked={state.checked}
                disabled={blocked}
                onChange={(event) =>
                  setState((latest) => ({
                    ...latest,
                    checked: event.target.checked,
                  }))
                }
              />
              I accept cancellation preparation for these exact amounts and
              terms, including the interest-forfeiture policy. I understand no
              refund is executed.
            </label>
          </>
        ) : (
          <p>A validated server cancellation quote is unavailable.</p>
        )}
        <p role="status" aria-live="polite">
          {state.action === 'prepared'
            ? 'Prepared only. Not refunded. Collection paused; interest unresolved and provider dispatch unavailable.'
            : state.action === 'uncertain'
              ? 'Preparation could not be confirmed. Reservation may be retained. Refresh authoritative status; do not resubmit.'
              : state.action === 'pending'
                ? 'Preparing cancellation. No refund is being executed.'
                : 'Review the server quote before preparing cancellation.'}
        </p>
        <ThemedButton
          type="button"
          disabled={blocked || !state.checked}
          onClick={prepare}
        >
          Prepare cancellation
        </ThemedButton>
      </ThemedCard>
    </section>
  );
}
