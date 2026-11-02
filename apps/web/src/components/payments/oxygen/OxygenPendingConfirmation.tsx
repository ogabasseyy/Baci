'use client';
import type { Dispatch, SetStateAction } from 'react';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenAddressProgress } from './OxygenAddressProgress';
import { OxygenApprovalUnconfirmed } from './OxygenApprovalUnconfirmed';
import { OxygenConfirmationNotice } from './OxygenConfirmationNotice';
import { OxygenLoanSummary } from './OxygenLoanSummary';
import { OxygenSavedPlans } from './OxygenSavedPlans';
import { OxygenSelfieButton } from './OxygenSelfieButton';
import type { useOxygenProvider } from './use-oxygen-provider';

type Props = {
  snapshot: OxygenRuntimeSnapshot | null;
  awaitingConfirmation: boolean;
  needsSignIn: boolean;
  busy: boolean;
  error: string;
  refresh: ReturnType<typeof useOxygenProvider>['refresh'];
  selfieConfirmed: boolean;
  setComparingPlans: Dispatch<SetStateAction<boolean>>;
};
export function OxygenPendingConfirmation({
  snapshot,
  awaitingConfirmation,
  needsSignIn,
  busy,
  error,
  refresh,
  selfieConfirmed,
  setComparingPlans,
}: Props) {
  const s = snapshot?.state;
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
          busy={busy}
          onCheck={refresh}
        />
      </section>
    );
  if (awaitingConfirmation && !needsSignIn)
    return (
      <section className="px-6 pb-6" aria-label="Oxygen finance application">
        {snapshot?.workflowId &&
          snapshot.pending?.action !== 'approve_booking' &&
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
          identityCheck={snapshot?.pending?.action === 'validate_nin'}
          busy={busy}
          refresh={refresh}
        />
      </section>
    );
  return null;
}
