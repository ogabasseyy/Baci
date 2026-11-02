'use client';

import { Camera, CloudSun } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';
import { oxygenEligibilityPrerequisites } from '@/lib/payments/oxygen/eligibility-prerequisites';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import { OxygenSelfieConfirmedContext } from './OxygenPaymentSurfaceContext';
import { OxygenSelfieButton } from './OxygenSelfieButton';
import { OxygenVerificationActivity } from './OxygenVerificationActivity';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { oxygenVerificationHeading } from './oxygen-verification-heading';

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
  const selfieConfirmed =
    useContext(OxygenSelfieConfirmedContext) === snapshot.workflowId;
  const eligibilityFailed = state.eligibilityStatus === 'failed';
  const active =
    enabled &&
    snapshot.executionEnabled &&
    state.validated &&
    !state.bookingReference &&
    ['eligibility_required', 'kyc_required'].includes(snapshot.stage);
  const selfieRequired =
    state.kyc?.selfie_status === 'NOT_DONE' && !selfieConfirmed;
  // Oxygen confirms the bank during eligibility; bank status cannot gate that check.
  const identityComplete = oxygenEligibilityPrerequisites(state);
  const ninRequired =
    identityComplete &&
    state.eligible === true &&
    state.kyc?.nin_status === 'NOT_DONE';
  const ninPending =
    identityComplete &&
    state.eligible === true &&
    state.kyc?.nin_status !== 'DONE';
  const bankPending = Boolean(
    identityComplete &&
      state.kyc?.nin_status === 'DONE' &&
      state.eligible === true &&
      state.eligibilityStatus === 'completed' &&
      state.kyc?.bank_status !== 'DONE'
  );

  useEffect(() => {
    if (
      !active ||
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
    let action:
      | 'refresh_eligibility'
      | 'refresh_kyc'
      | 'selfie_link'
      | 'validate_nin';
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
    } else if (ninRequired && !count('validate_nin')) {
      action = 'validate_nin';
    } else {
      action = 'refresh_kyc';
      delay = bankPending && !count('bank_confirmation') ? 0 : 20_000;
    }
    // Bound polling and never automatically repeat a failed or uncertain command.
    if (
      count(action) >=
      (action === 'refresh_kyc' ? 5 : action === 'refresh_eligibility' ? 3 : 1)
    )
      return;
    const timer = window.setTimeout(() => {
      attempts.current.set(action, count(action) + 1);
      if (action === 'refresh_kyc' && bankPending)
        attempts.current.set('bank_confirmation', 1);
      void submit({ action });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    active,
    ninRequired,
    busy,
    retrying,
    error,
    snapshot.pending,
    state,
    identityComplete,
    bankPending,
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
  const selfie = selfieRequired && state.selfieUrl;
  const recoverable = !selfie && (eligibilityFailed || review);
  async function retryCheck() {
    if (busy || retryLock.current || snapshot.pending) return;
    retryLock.current = true;
    setRetrying(true);
    const action =
      identityComplete && !state.eligible
        ? 'refresh_eligibility'
        : 'refresh_kyc';
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
          {oxygenVerificationHeading({
            selfie: Boolean(selfie),
            selfieConfirmed,
            ninPending,
            bankPending,
            review,
            checking: busy || retrying,
            identityComplete,
            bvnDone: state.kyc?.bvn_status === 'DONE',
            eligibilityFailed,
          })}
        </h3>
        <p className="text-sm leading-relaxed text-gray-500">
          {selfie
            ? 'Opening Oxygen’s secure camera check. We’ll continue automatically when your selfie is confirmed.'
            : ninPending
              ? 'Your eligibility check is complete. We’re finishing your identity verification before showing your payment plans.'
              : bankPending
                ? 'Your identity checks are complete. Oxygen has not confirmed your bank account yet. Your progress is saved.'
                : busy || retrying
                  ? identityComplete
                    ? 'We’re checking your available payment options with Oxygen.'
                    : selfieConfirmed
                      ? 'Your selfie is confirmed. We’re updating your identity checks with Oxygen.'
                      : state.kyc?.bvn_status === 'DONE'
                        ? 'Getting Oxygen’s secure camera check ready for you.'
                        : 'We’re confirming your BVN with Oxygen.'
                  : eligibilityFailed
                    ? 'Oxygen is taking longer than expected. Your details and verification are saved. Try again to continue.'
                    : review
                      ? 'Oxygen is still processing your check. Your details are saved, and you can check again when you’re ready.'
                      : selfieConfirmed
                        ? 'Your selfie is confirmed. We’re updating your identity checks with Oxygen.'
                        : state.kyc?.bvn_status === 'DONE'
                          ? 'Getting Oxygen’s secure camera check ready for you.'
                          : 'We’re confirming your BVN with Oxygen.'}
        </p>
      </div>
      {selfie ? (
        <OxygenSelfieButton url={selfie} workflowId={snapshot.workflowId} />
      ) : recoverable ? (
        <OxygenLoadingButton
          type="button"
          loading={busy || retrying}
          disabled={Boolean(snapshot.pending)}
          pendingLabel="Checking your payment options…"
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
