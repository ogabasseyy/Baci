'use client';

import { Camera, CloudSun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import { OxygenSelfieButton } from './OxygenSelfieButton';
import { OxygenVerificationActivity } from './OxygenVerificationActivity';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

type Props = {
  snapshot: OxygenRuntimeSnapshot;
  busy: boolean;
  error: string;
  submit: SubmitOxygenForm;
  enabled?: boolean;
};

/** Only nonfinancial prerequisite checks run here. Customer decisions stay explicit. */
export function OxygenGuidedVerification({
  snapshot,
  busy,
  error,
  submit,
  enabled = true,
}: Props) {
  const attempts = useRef(new Map<string, number>());
  useEffect(() => {
    if (!enabled) attempts.current.clear();
  }, [enabled]);
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);
  const state = snapshot.state;
  const eligibilityFailed = state.eligibilityStatus === 'failed';
  const active =
    enabled &&
    snapshot.executionEnabled &&
    state.validated &&
    !state.bookingReference &&
    ['eligibility_required', 'kyc_required'].includes(snapshot.stage);
  const selfieRequired = state.kyc?.selfie_status === 'NOT_DONE';
  const ninPaused =
    state.kyc?.selfie_status === 'DONE' && state.kyc.nin_status === 'NOT_DONE';
  const identityComplete = Boolean(
    state.kyc &&
      (
        [
          'bvn_status',
          'nin_status',
          'bank_status',
          'phone_status',
          'selfie_status',
        ] as const
      ).every((key) => state.kyc?.[key] === 'DONE')
  );

  useEffect(() => {
    if (
      !active ||
      ninPaused ||
      busy ||
      retrying ||
      error ||
      snapshot.pending ||
      state.eligible === false ||
      eligibilityFailed
    )
      return;
    const count = (key: string) => attempts.current.get(key) ?? 0;
    if (
      identityComplete &&
      !state.eligible &&
      count('refresh_eligibility') >= 3
    )
      return;
    let action: 'refresh_eligibility' | 'refresh_kyc' | 'selfie_link';
    let delay = 0;
    if (!state.kyc) {
      action = 'refresh_kyc';
    } else if (selfieRequired && !state.selfieUrl && !count('selfie_link')) {
      action = 'selfie_link';
    } else if (
      identityComplete &&
      !state.eligible &&
      count('refresh_eligibility') < 3
    ) {
      action = 'refresh_eligibility';
      delay = count(action) ? 20_000 : 0;
    } else {
      action = 'refresh_kyc';
      delay = 20_000;
    }
    // Bound polling and never automatically repeat a failed or uncertain command.
    if (
      count(action) >=
      (action === 'refresh_kyc' ? 5 : action === 'refresh_eligibility' ? 3 : 1)
    )
      return;
    const timer = window.setTimeout(() => {
      attempts.current.set(action, count(action) + 1);
      void submit({ action });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    active,
    ninPaused,
    busy,
    retrying,
    error,
    snapshot.pending,
    state,
    identityComplete,
    selfieRequired,
    eligibilityFailed,
    submit,
  ]);

  if (!active || error) return null;
  const review =
    !busy &&
    ((attempts.current.get('refresh_kyc') ?? 0) >= 5 ||
      (identityComplete &&
        !state.eligible &&
        (attempts.current.get('refresh_eligibility') ?? 0) >= 3));
  if (state.eligible === false)
    return (
      <div className="mx-auto grid max-w-md gap-3 py-8 text-center">
        <h3 className="text-xl font-bold text-gray-900">
          No installment plan is available right now
        </h3>
        <p className="text-sm leading-relaxed text-gray-500">
          Your application is saved. You can close this window and choose
          another payment method at checkout.
        </p>
      </div>
    );
  if (ninPaused)
    return (
      <div
        role="status"
        className="mx-auto grid max-w-md gap-2 py-8 text-center"
      >
        <h3 className="text-xl font-bold text-gray-900">Selfie verified</h3>
        <p className="text-sm text-gray-500">
          The next identity check is paused for this staging test. Your progress
          is saved.
        </p>
      </div>
    );
  const selfie = selfieRequired && state.selfieUrl;
  const recoverable = !selfie && (eligibilityFailed || review);
  async function retryCheck() {
    if (busy || retryLock.current || snapshot.pending) return;
    retryLock.current = true;
    setRetrying(true);
    const action = identityComplete ? 'refresh_eligibility' : 'refresh_kyc';
    attempts.current.set(action, 1);
    try {
      await submit({ action });
    } finally {
      retryLock.current = false;
      setRetrying(false);
    }
  }
  return (
    <div className="mx-auto grid w-full max-w-md justify-items-center gap-5 py-6 text-center">
      {selfie ? (
        <span className="flex size-14 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
          <Camera className="size-6" aria-hidden="true" />
        </span>
      ) : recoverable && !busy && !retrying ? (
        <span className="flex size-16 items-center justify-center rounded-3xl bg-amber-50 text-amber-600">
          <CloudSun className="size-8" aria-hidden="true" />
        </span>
      ) : (
        <OxygenVerificationActivity />
      )}
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-gray-900">
          {selfie
            ? 'A quick selfie to confirm it’s you'
            : busy || retrying
              ? identityComplete
                ? 'Checking with Oxygen'
                : 'Verifying your identity'
              : eligibilityFailed
                ? 'A little pause from Oxygen'
                : review
                  ? 'This is taking a little longer'
                  : 'Finding your payment options'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-500">
          {selfie
            ? 'Complete Oxygen’s secure selfie check, then return here. We’ll check your progress automatically.'
            : busy || retrying
              ? identityComplete
                ? 'We’re checking your available payment options with Oxygen.'
                : 'Your code is verified. We’re checking your identity with Oxygen before showing your payment plans.'
              : eligibilityFailed
                ? 'Oxygen couldn’t finish this check just now. Your details are saved—try again in a moment.'
                : review
                  ? 'Oxygen is still processing your check. Your details are saved, and you can check again when you’re ready.'
                  : 'Your phone is verified. We’re checking your identity and available payment plans with Oxygen.'}
        </p>
      </div>
      {selfie ? (
        <OxygenSelfieButton url={selfie} workflowId={snapshot.workflowId} />
      ) : recoverable ? (
        <OxygenLoadingButton
          type="button"
          loading={busy || retrying}
          disabled={Boolean(snapshot.pending)}
          pendingLabel="Checking again…"
          onClick={() => void retryCheck()}
          className="w-full sm:w-auto sm:min-w-44"
        >
          Try again
        </OxygenLoadingButton>
      ) : (
        <p role="status" className="sr-only">
          A moment while we check with Oxygen…
        </p>
      )}
      <p className="text-xs leading-relaxed text-gray-400">
        Your progress stays saved if you close this window.
      </p>
    </div>
  );
}
