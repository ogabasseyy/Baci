'use client';
import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/api-client';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenAddressProgress } from './OxygenAddressProgress';
import { OxygenApprovalUnconfirmed } from './OxygenApprovalUnconfirmed';
import { OxygenConfirmationNotice } from './OxygenConfirmationNotice';
import { OxygenLoanSummary } from './OxygenLoanSummary';
import { OxygenQueuedAddressRecovery } from './OxygenQueuedAddressRecovery';
import { OxygenSavedPlans } from './OxygenSavedPlans';
import { OxygenSelfieButton } from './OxygenSelfieButton';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { pendingReadRecovery } from './oxygen-read-recovery';
import type { useOxygenProvider } from './use-oxygen-provider';

type Props = {
  snapshot: OxygenRuntimeSnapshot | null;
  awaitingConfirmation?: boolean;
  needsSignIn: boolean;
  busy: boolean;
  error: string;
  refresh: ReturnType<typeof useOxygenProvider>['refresh'];
  submit?: SubmitOxygenForm;
  checkAddress?: () => Promise<void>;
  checkPending?: () => Promise<void>;
  selfieConfirmed: boolean;
  setComparingPlans: Dispatch<SetStateAction<boolean>>;
};
export function OxygenPendingConfirmation({
  snapshot,
  awaitingConfirmation = true,
  needsSignIn,
  busy,
  error,
  refresh,
  submit,
  checkAddress,
  checkPending,
  selfieConfirmed,
  setComparingPlans,
}: Props) {
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingFailed, setBookingFailed] = useState(false);
  const bookingLock = useRef(false);
  async function resumeBooking() {
    const pending = snapshot?.pending;
    if (
      bookingLock.current ||
      !snapshot ||
      pending?.action !== 'book' ||
      pending.status !== 'queued' ||
      !pending.bookingTerms
    )
      return;
    bookingLock.current = true;
    setBookingBusy(true);
    setBookingFailed(false);
    try {
      const response = await fetchWithCsrf('/api/payments/oxygen/plans/quote', {
        method: 'POST',
        cache: 'no-store',
        body: JSON.stringify({
          workflowId: snapshot.workflowId,
          idempotencyKey: pending.idempotencyKey,
          ...pending.bookingTerms,
        }),
      });
      if (!response.ok) throw new Error('Unavailable');
      await refresh();
    } catch {
      setBookingFailed(true);
      await refresh();
    } finally {
      bookingLock.current = false;
      setBookingBusy(false);
    }
  }
  const s = snapshot?.state;
  if (
    awaitingConfirmation &&
    !needsSignIn &&
    snapshot &&
    submit &&
    pendingReadRecovery(snapshot) === 'submit_address'
  )
    return (
      <OxygenQueuedAddressRecovery
        snapshot={snapshot}
        busy={busy}
        error={error}
        refresh={refresh}
        submit={submit}
      />
    );
  if (
    awaitingConfirmation &&
    !needsSignIn &&
    snapshot?.pending?.action === 'approve_booking' &&
    snapshot.pending.status === 'indeterminate' &&
    s?.bookingReference
  )
    return (
      <div className="px-6 pb-6">
        <OxygenApprovalUnconfirmed busy={busy} refresh={refresh} />
      </div>
    );
  if (
    awaitingConfirmation &&
    !needsSignIn &&
    snapshot?.pending?.action === 'refresh_kyc' &&
    s?.bookingReference &&
    s.kyc?.address_status === 'PROCESSING'
  )
    return (
      <section className="px-6 pb-6" aria-label="Oxygen finance application">
        <OxygenAddressProgress
          submitted
          delayed
          statusUnavailable={Boolean(error)}
          busy={busy || bookingBusy}
          onCheck={
            pendingReadRecovery(snapshot) === 'refresh_kyc'
              ? snapshot.stage === 'booked' && checkAddress
                ? checkAddress
                : (checkPending ?? refresh)
              : refresh
          }
        />
      </section>
    );
  if (awaitingConfirmation && !needsSignIn)
    return (
      <section className="px-6 pb-6" aria-label="Oxygen finance application">
        {snapshot?.workflowId &&
          snapshot.pending?.action !== 'approve_booking' &&
          snapshot.pending?.action !== 'trigger_approval_otp' &&
          !(
            snapshot.pending?.action === 'book' &&
            snapshot.pending.status === 'queued'
          ) &&
          s?.booking &&
          (s.booking.status === 'BOOKED' ? (
            <OxygenSavedPlans
              key={snapshot.workflowId}
              workflowId={snapshot.workflowId}
              state={s}
              onReady={setComparingPlans}
            />
          ) : (
            <OxygenLoanSummary state={s} />
          ))}
        {snapshot?.pending?.action === 'validate_nin' &&
          !selfieConfirmed &&
          s?.selfieUrl &&
          s.kyc?.selfie_status !== 'DONE' && (
            <div className="mx-auto max-w-md pb-4 pt-6">
              <OxygenSelfieButton
                url={s.selfieUrl}
                workflowId={snapshot.workflowId}
              />
            </div>
          )}
        {selfieConfirmed && (
          <p
            role="status"
            className="pt-6 text-center text-sm text-emerald-700"
          >
            Selfie verified. Your NIN check remains paused.
          </p>
        )}
        <OxygenConfirmationNotice
          booking={snapshot?.pending?.action === 'book'}
          queuedApprovalCode={
            pendingReadRecovery(snapshot) === 'trigger_approval_otp'
          }
          approvalCodeError={
            pendingReadRecovery(snapshot) === 'trigger_approval_otp' &&
            Boolean(error)
          }
          queuedBooking={pendingReadRecovery(snapshot) === 'book'}
          bookingTerms={snapshot?.pending?.bookingTerms}
          bookingError={
            pendingReadRecovery(snapshot) === 'book' &&
            (Boolean(error) || bookingFailed)
          }
          identityCheck={snapshot?.pending?.action === 'validate_nin'}
          queuedIdentityCheck={pendingReadRecovery(snapshot) === 'validate_nin'}
          queuedSelfieCheck={pendingReadRecovery(snapshot) === 'selfie_link'}
          selfieError={
            pendingReadRecovery(snapshot) === 'selfie_link' && Boolean(error)
          }
          identityError={
            pendingReadRecovery(snapshot) === 'validate_nin' && Boolean(error)
          }
          eligibilityCheck={
            snapshot?.pending?.action === 'refresh_eligibility' &&
            snapshot.pending.status !== 'queued'
          }
          busy={busy || bookingBusy}
          refresh={
            pendingReadRecovery(snapshot) === 'book'
              ? resumeBooking
              : [
                    'refresh_kyc',
                    'refresh_details',
                    'refresh_eligibility',
                    'refresh_payment_setup',
                    'validate_nin',
                    'selfie_link',
                    'trigger_approval_otp',
                  ].includes(pendingReadRecovery(snapshot) ?? '') &&
                  checkPending
                ? checkPending
                : refresh
          }
        />
      </section>
    );
  return null;
}
