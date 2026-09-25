'use client';

import { QUIZ_DEFAULT_TIME_ZONE } from '@baci/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type {
  QuizAnswerKeyReview,
  QuizDraftConfiguration,
  QuizLaunchInput,
} from './quiz-admin-actions';
import { quizDatetimeLocalToIso } from './quiz-datetime-local';
import { formatQuizDuration } from './quiz-format-duration';

function formatPolicyInstant(value: string): string {
  // The offset-free field value is a policy-zone wall clock, not a
  // browser-local instant: derive the instant in the policy zone first so an
  // admin outside Africa/Lagos sees the time that will actually activate.
  const iso = quizDatetimeLocalToIso(value, QUIZ_DEFAULT_TIME_ZONE);
  if (!iso) return value;
  return new Date(iso).toLocaleString(undefined, {
    timeZone: QUIZ_DEFAULT_TIME_ZONE,
  });
}

function timingSummary(configuration: QuizDraftConfiguration): string {
  if (configuration.timingKind === 'scheduled') {
    return `${formatPolicyInstant(configuration.scheduledStart)} to ${formatPolicyInstant(configuration.scheduledEnd)} (${QUIZ_DEFAULT_TIME_ZONE})`;
  }
  return `Immediately, closing after ${formatQuizDuration(Math.round(configuration.liveWindowMinutes * 60))}`;
}

export function QuizLaunchDialog({
  activationError,
  answerKeyReview,
  configuration,
  isLaunching,
  onCancel,
  onConfirm,
}: {
  activationError?: string | null;
  answerKeyReview: QuizAnswerKeyReview;
  configuration: QuizDraftConfiguration;
  isLaunching: boolean;
  onCancel: () => void;
  onConfirm: (
    review: QuizAnswerKeyReview,
    regulatoryCompliance?: QuizLaunchInput['regulatoryCompliance']
  ) => void;
}) {
  const [regulatoryBasis, setRegulatoryBasis] = useState<
    NonNullable<QuizLaunchInput['regulatoryCompliance']>['basis']
  >('free_skill_competition');
  const [jurisdiction, setJurisdiction] = useState('NG-LA');
  const [evidenceReference, setEvidenceReference] = useState('');
  const liveEvidenceComplete = Boolean(
    jurisdiction.trim().length >= 2 && evidenceReference.trim().length >= 3
  );

  const confirm = () => {
    if (configuration.mode === 'test') {
      onConfirm(answerKeyReview);
      return;
    }
    if (!liveEvidenceComplete) return;
    onConfirm(answerKeyReview, {
      basis: regulatoryBasis,
      evidenceReference: evidenceReference.trim(),
      jurisdiction: jurisdiction.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      role="presentation"
    >
      <section
        aria-labelledby="launch-dialog-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl"
        role="dialog"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Confirm {configuration.mode} launch
        </p>
        <h3 className="mt-2 text-xl font-semibold" id="launch-dialog-title">
          Launch quiz?
        </h3>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Prize</dt>
          <dd>
            {configuration.prizeProduct.name}
            {configuration.prizeProduct.variantLabel
              ? ` — ${configuration.prizeProduct.variantLabel}`
              : ''}
          </dd>
          <dt className="text-muted-foreground">Questions</dt>
          <dd>{answerKeyReview.questions.length}</dd>
          <dt className="text-muted-foreground">Timer</dt>
          <dd>{configuration.timePerQuestionSeconds} seconds per question</dd>
          <dt className="text-muted-foreground">Window</dt>
          <dd>{timingSummary(configuration)}</dd>
          <dt className="text-muted-foreground">Mode</dt>
          <dd className="capitalize">{configuration.mode}</dd>
        </dl>
        {configuration.mode === 'live' ? (
          <div className="mt-4 grid gap-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p>
              Record the legal basis for this prize competition. The server will
              also verify production approval and reserve the prize atomically.
            </p>
            <label className="grid gap-2 font-medium">
              Regulatory basis
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={regulatoryBasis}
                onChange={(event) =>
                  setRegulatoryBasis(
                    event.target.value as NonNullable<
                      QuizLaunchInput['regulatoryCompliance']
                    >['basis']
                  )
                }
              >
                <option value="free_skill_competition">
                  Free skill competition — no payment or chance
                </option>
                <option value="state_permit">State permit</option>
                <option value="fccpc_registration">
                  FCCPC sales-promotion registration
                </option>
              </select>
            </label>
            <label className="grid gap-2 font-medium">
              Covered jurisdiction
              <input
                className="h-10 rounded-md border bg-background px-3"
                maxLength={100}
                onChange={(event) => setJurisdiction(event.target.value)}
                placeholder="e.g. NG-LA"
                value={jurisdiction}
              />
            </label>
            <label className="grid gap-2 font-medium">
              Evidence reference
              <input
                className="h-10 rounded-md border bg-background px-3"
                maxLength={240}
                onChange={(event) => setEvidenceReference(event.target.value)}
                placeholder="Counsel memo, approved rules, permit, or filing reference"
                value={evidenceReference}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              For the free-skill basis, the rules must guarantee free entry,
              deterministic ranking, and no random tie-breaker.
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sm">
            Test mode is a private rehearsal. No prize inventory is reserved or
            awarded.
          </p>
        )}
        {activationError ? (
          <p
            className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {activationError}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="h-10 rounded-md border px-4 text-sm font-medium"
            disabled={isLaunching}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={
              isLaunching ||
              (configuration.mode === 'live' && !liveEvidenceComplete)
            }
            onClick={confirm}
            type="button"
          >
            {isLaunching ? <Loader2 className="size-4 animate-spin" /> : null}
            Launch quiz
          </button>
        </div>
      </section>
    </div>
  );
}
