'use client';

import { useRef, useState } from 'react';
import { ThemedButton } from '@/components/themed/themed-button';
import { ThemedCard } from '@/components/themed/themed-card';
import { piggyvestPolicyReviewSchemas } from '@/schemas/piggyvest-policy-review';
import type { PolicyReviewProps } from './policy-review.types';

function DraftReview({
  draft,
  onAccept,
}: {
  draft: Extract<PolicyReviewProps['view'], { status: 'draft' }>;
  onAccept: PolicyReviewProps['onAccept'];
}) {
  const [checked, setChecked] = useState(false);
  const [action, setAction] = useState<
    'idle' | 'pending' | 'error' | 'submitted'
  >('idle');
  const inFlight = useRef(false);
  const disabled = action === 'pending' || action === 'submitted';

  async function accept() {
    if (
      !checked ||
      disabled ||
      inFlight.current ||
      draft.consent !== 'required'
    )
      return;
    inFlight.current = true;
    setAction('pending');
    try {
      await onAccept({
        goalId: draft.goalId,
        revisionId: draft.revisionId,
        termsHash: draft.terms.hash,
        termsVersion: draft.terms.version,
        accepted: true,
        ...(draft.durationMonths === undefined
          ? {}
          : { durationMonths: draft.durationMonths }),
      });
      setAction('submitted');
    } catch {
      setAction('error');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      <dl className="space-y-2 break-words">
        <div>
          <dt>Product</dt>
          <dd>{draft.device.productName}</dd>
        </div>
        {draft.device.variant !== null && (
          <div>
            <dt>Variant</dt>
            <dd>{draft.device.variant}</dd>
          </div>
        )}
        <div>
          <dt>Condition</dt>
          <dd>{draft.device.condition}</dd>
        </div>
      </dl>
      {draft.durationMonths !== undefined && (
        <dl>
          <dt>Duration</dt>
          <dd>
            {draft.durationMonths}{' '}
            {draft.durationMonths === 1 ? 'month' : 'months'}
          </dd>
        </dl>
      )}
      <h3 className="font-semibold">Terms — {draft.terms.version}</h3>
      <p className="whitespace-pre-wrap break-words">{draft.terms.text}</p>
      <p role="status" aria-live="polite" aria-atomic="true">
        {draft.consent === 'accepted'
          ? 'Consent recorded for this draft.'
          : action === 'pending'
            ? 'Submitting acceptance…'
            : action === 'submitted'
              ? 'Acceptance submitted. Refresh the draft to confirm its recorded consent.'
              : 'Consent is required for this draft.'}
      </p>
      {draft.consent === 'required' && (
        <>
          {action === 'error' && (
            <p role="alert">
              Acceptance could not be confirmed. Retry or refresh this draft.
            </p>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 accent-store-primary"
              checked={checked}
              disabled={disabled}
              onChange={(event) => setChecked(event.target.checked)}
            />
            I accept the supplied terms for this draft.
          </label>
          <ThemedButton
            type="button"
            disabled={!checked || disabled}
            onClick={accept}
          >
            {action === 'error' ? 'Retry acceptance' : 'Accept draft terms'}
          </ThemedButton>
        </>
      )}
    </>
  );
}

export function PolicyReview({
  sessionKey,
  view,
  onAccept,
}: PolicyReviewProps) {
  const parsed = piggyvestPolicyReviewSchemas.view.safeParse(view);
  const draft =
    sessionKey?.trim() && parsed.success && parsed.data.status === 'draft'
      ? parsed.data
      : null;

  return (
    <section aria-label="Draft policy review">
      <ThemedCard
        borderColor="primary"
        className="space-y-4 bg-store-background p-4 text-store-background-text"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Draft policy review</h2>
          <span className="rounded border border-store-primary px-2 py-1 text-sm">
            Staging
          </span>
        </div>
        <p>Test environment only. Review of draft terms only.</p>
        {draft ? (
          <DraftReview
            key={JSON.stringify([sessionKey, draft])}
            draft={draft}
            onAccept={onAccept}
          />
        ) : (
          <p role="status" aria-live="polite">
            {sessionKey?.trim() && view.status === 'loading'
              ? 'Loading draft terms…'
              : 'Draft review is unavailable.'}
          </p>
        )}
      </ThemedCard>
    </section>
  );
}
