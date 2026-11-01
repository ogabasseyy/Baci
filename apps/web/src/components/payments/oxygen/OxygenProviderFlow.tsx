'use client';
import { useEffect, useRef, useState } from 'react';
import { oxygenActiveLoanMessage } from '@/lib/payments/oxygen/booking-rejection';
import { oxygenCustomerStep } from '@/lib/payments/oxygen/customer-step';
import {
  type OxygenJourneyStage,
  trackOxygenJourney,
} from '@/lib/payments/oxygen/journey-events';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import { OxygenAddressProgress } from './OxygenAddressProgress';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenApprovalUnconfirmed } from './OxygenApprovalUnconfirmed';
import { OxygenBookedPlanReview } from './OxygenBookedPlanReview';
import { OxygenCompletedApplication } from './OxygenCompletedApplication';
import { OxygenConfirmationNotice } from './OxygenConfirmationNotice';
import { OxygenCustomerForm } from './OxygenCustomerForm';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';
import { OxygenLoanSummary } from './OxygenLoanSummary';
import { OxygenPaymentCompletion } from './OxygenPaymentCompletion';
import { OxygenPaymentRecovery } from './OxygenPaymentRecovery';
import { OxygenPlanForm } from './OxygenPlanForm';
import {
  type OxygenCheckoutProduct,
  OxygenProductSummary,
} from './OxygenProductSummary';
import { OxygenSavedPlans } from './OxygenSavedPlans';
import { OxygenSelfieButton } from './OxygenSelfieButton';
import { OxygenSignIn } from './OxygenSignIn';
import { OxygenVerificationForms } from './OxygenVerificationForms';
import { OxygenWorkflowError } from './OxygenWorkflowError';
import { submitOxygenVerificationForm } from './submit-oxygen-verification-form';
import { useOxygenApprovedPayment } from './use-oxygen-approved-payment';
import { useOxygenBookingProgress } from './use-oxygen-booking-progress';
import { useOxygenConfirmationUpdates } from './use-oxygen-confirmation-updates';
import { useOxygenProvider } from './use-oxygen-provider';
import { useOxygenResidentialContext } from './use-oxygen-residential-context';
import { useOxygenResidentialSubmission } from './use-oxygen-residential-submission';
import { useOxygenSavedUpdates } from './use-oxygen-saved-updates';
import { useOxygenSelfieHandoff } from './use-oxygen-selfie-handoff';

type FlowProps = {
  orderId: string;
  merchantSlug?: string;
  productAmount?: number;
  products?: OxygenCheckoutProduct[];
  currency?: string;
  active?: boolean;
  prefill?: OxygenCustomerPrefill;
  onProgress?: (stage: OxygenJourneyStage) => void;
};
export function OxygenProviderFlow({
  orderId,
  merchantSlug,
  productAmount,
  products,
  currency,
  prefill,
  active = true,
  onProgress,
}: FlowProps) {
  return (
    <OxygenProviderSession
      key={orderId}
      orderId={orderId}
      merchantSlug={merchantSlug}
      prefill={prefill}
      productAmount={productAmount}
      products={products}
      currency={currency}
      active={active}
      onProgress={onProgress}
    />
  );
}
function OxygenProviderSession({
  orderId,
  merchantSlug,
  productAmount,
  products,
  currency,
  prefill,
  active = true,
  onProgress,
}: FlowProps) {
  const {
    snapshot,
    busy,
    error,
    errorAction,
    clearError,
    submit,
    refresh,
    readSaved,
    needsSignIn,
  } = useOxygenProvider(orderId);
  const selfieConfirmed = useOxygenSelfieHandoff(
    snapshot,
    active,
    busy,
    submit,
    refresh
  );
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void refresh();
    wasActive.current = active;
  }, [active, refresh]);
  const s = snapshot?.state;
  const [acceptedPlanReference, setAcceptedPlanReference] = useState<string>();
  const reviewBookedPlan = Boolean(
    (snapshot?.stage === 'booked' ||
      (snapshot?.stage === 'approval_required' &&
        !snapshot.approvalOtpReady)) &&
      s?.booking?.status === 'BOOKED' &&
      s.bookingReference &&
      acceptedPlanReference !== s.bookingReference
  );
  const [replacingAddress, setReplacingAddress] = useState(false);
  const [comparingPlans, setComparingPlans] = useState(false);
  const [submittedAddressFor, setSubmittedAddressFor] = useState<string | null>(
    null
  );
  const addressWaiting = Boolean(
    s?.bookingReference &&
      (submittedAddressFor === s.bookingReference ||
        s.kyc?.address_status === 'PROCESSING')
  );
  useOxygenSavedUpdates(
    snapshot?.workflowId,
    active &&
      snapshot?.stage === 'booked' &&
      addressWaiting &&
      !replacingAddress,
    busy || Boolean(snapshot?.pending),
    readSaved
  );
  const bookingProgress = useOxygenBookingProgress(
    snapshot,
    busy || replacingAddress,
    error,
    active,
    addressWaiting,
    submit
  );
  const submitForm = submitOxygenVerificationForm(
    submit,
    s?.bookingReference,
    (reference) => {
      setSubmittedAddressFor(reference);
      setReplacingAddress(false);
      bookingProgress.restartAddressReview();
    }
  );
  const residentialContext = useOxygenResidentialContext(
    snapshot?.stage === 'application_required' ? snapshot.workflowId : undefined
  );
  const residential = useOxygenResidentialSubmission(
    snapshot,
    active && !reviewBookedPlan,
    busy,
    error,
    submitForm
  );
  const lastStage = useRef<string>('loading');
  useEffect(() => {
    if (!snapshot) return;
    const stage = oxygenCustomerStep(snapshot, addressWaiting);
    if (lastStage.current === stage) return;
    lastStage.current = stage;
    onProgress?.(stage);
    trackOxygenJourney('stage_reached', orderId, stage);
  }, [addressWaiting, orderId, onProgress, snapshot]);
  const disabled =
    busy ||
    !snapshot?.executionEnabled ||
    Boolean(snapshot.pending && snapshot.pending.status !== 'queued');
  const approval = useOxygenApprovedPayment(snapshot, disabled, submit);
  const awaitingConfirmation = Boolean(
    snapshot &&
      (snapshot.stage === 'reconciliation_required' ||
        snapshot.pending?.status === 'indeterminate' ||
        snapshot.pending?.status === 'executing')
  );
  useOxygenConfirmationUpdates(
    snapshot?.workflowId,
    awaitingConfirmation,
    active,
    busy,
    refresh
  );
  if (snapshot?.stage === 'activated' && s?.bookingReference)
    return <OxygenCompletedApplication products={products} />;
  const activeLoanError =
    snapshot?.bookingBlock === 'active_loan' ||
    error === oxygenActiveLoanMessage;
  const phoneError =
    snapshot?.stage === 'eligibility_required' &&
    !s?.validated &&
    (errorAction === 'validate_customer' ||
      errorAction === 'resend_customer_otp')
      ? error
      : '';
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
  if (reviewBookedPlan && snapshot && s?.bookingReference)
    return (
      <section
        className="space-y-5 p-6 pt-0"
        aria-label="Oxygen finance application"
      >
        {products && (
          <OxygenProductSummary products={products} currency={currency} />
        )}
        {error && (
          <OxygenWorkflowError
            snapshot={snapshot}
            activeLoan={activeLoanError}
            action={errorAction}
            error={error}
            merchantSlug={merchantSlug}
            busy={busy}
            submit={submit}
            refresh={refresh}
          />
        )}
        <OxygenBookedPlanReview
          key={s.bookingReference}
          workflowId={snapshot.workflowId}
          state={s}
          busy={disabled}
          onAccept={(reference) => {
            setAcceptedPlanReference(reference);
            void readSaved();
          }}
        />
      </section>
    );
  return (
    <section
      className="space-y-5 p-6 pt-0"
      aria-label="Oxygen finance application"
    >
      {(error || activeLoanError) &&
        !phoneError &&
        !needsSignIn &&
        !(
          snapshot?.stage === 'payment_required' &&
          snapshot.executionEnabled &&
          s?.bookingReference
        ) && (
          <OxygenWorkflowError
            snapshot={snapshot}
            activeLoan={activeLoanError}
            action={errorAction}
            error={error}
            merchantSlug={merchantSlug}
            busy={busy}
            submit={submit}
            refresh={refresh}
          />
        )}
      {busy && !snapshot && <OxygenApplicationLoading />}
      {needsSignIn && (
        <OxygenSignIn
          merchantSlug={merchantSlug}
          onSignedIn={() => window.location.reload()}
        />
      )}
      {snapshot && (
        <>
          {!snapshot.executionEnabled && (
            <p role="status">
              Finance setup is not available yet. Your saved application is
              preserved.
            </p>
          )}
          {snapshot.stage === 'application_required' &&
            residentialContext.ready && (
              <OxygenCustomerForm
                workflowId={snapshot.workflowId}
                prefill={prefill}
                checkoutAddress={residentialContext.address}
                onResidentialReady={(proof) =>
                  residential.prepare(snapshot.workflowId, proof)
                }
                phone={snapshot.checkoutPhone}
                busy={disabled}
                submit={submit}
                onProgress={(stage, completed) => {
                  if (completed)
                    trackOxygenJourney('step_completed', orderId, completed);
                  onProgress?.(stage);
                  trackOxygenJourney('stage_reached', orderId, stage);
                }}
              />
            )}
          <OxygenGuidedVerification
            enabled={active}
            snapshot={snapshot}
            busy={busy}
            error={error}
            submit={submit}
          />
          {snapshot.stage === 'plan_required' && !activeLoanError && (
            <OxygenPlanForm
              busy={disabled}
              maxTenure={s?.maxTenure}
              productAmount={productAmount}
              submit={submit}
            />
          )}
          {s?.booking &&
            products &&
            !['payment_required', 'ready_for_activation'].includes(
              snapshot.stage
            ) && (
              <OxygenProductSummary products={products} currency={currency} />
            )}
          {s?.booking &&
            snapshot.stage !== 'booked' &&
            snapshot.stage !== 'ready_for_activation' &&
            (s.booking.status === 'BOOKED' ? (
              <OxygenSavedPlans
                key={snapshot.workflowId}
                workflowId={snapshot.workflowId}
                state={s}
                onReady={setComparingPlans}
                approvalReference={
                  snapshot.approvalOtpReady ||
                  (snapshot.stage === 'approval_required' &&
                    acceptedPlanReference === s.bookingReference)
                    ? s.bookingReference
                    : undefined
                }
                approvePlan={approval.approvePlan}
                approvalBusy={disabled}
                requestApprovalCode={approval.requestApprovalCode}
              />
            ) : !['payment_required', 'ready_for_activation'].includes(
                snapshot.stage
              ) ? (
              <OxygenLoanSummary state={s} />
            ) : null)}
          {snapshot.stage === 'booked' &&
            !replacingAddress &&
            (addressWaiting || residential.waiting) && (
              <OxygenAddressProgress
                submitted={addressWaiting}
                delayed={bookingProgress.addressDelayed}
                manualReview={bookingProgress.manualReviewNeeded}
                statusUnavailable={bookingProgress.addressStatusUnavailable}
                busy={disabled || Boolean(snapshot.pending)}
                onReplace={() => setReplacingAddress(true)}
                onCheck={bookingProgress.checkAddress}
              />
            )}
          {snapshot.stage === 'booked' && replacingAddress && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              <p>Replace your proof to try automatic verification again.</p>
              <button
                type="button"
                className="min-h-11 shrink-0 px-2 font-semibold text-store-primary"
                disabled={busy}
                onClick={() => setReplacingAddress(false)}
              >
                Wait for manual review
              </button>
            </div>
          )}
          <OxygenVerificationForms
            stage={
              snapshot.stage === 'approval_required' &&
              (comparingPlans || s?.booking?.status === 'BOOKED')
                ? 'plan_comparison'
                : snapshot.stage === 'eligibility_required' && s?.validated
                  ? 'phone_complete'
                  : snapshot.stage === 'booked' &&
                      !replacingAddress &&
                      (addressWaiting || residential.waiting)
                    ? 'address_review'
                    : snapshot.stage
            }
            address={{}}
            workflowId={snapshot.workflowId}
            residentialProof={replacingAddress ? undefined : residential.proof}
            approvalOtpReady={snapshot.approvalOtpReady}
            validated={s?.validated}
            phoneError={phoneError}
            clearPhoneError={clearError}
            busy={disabled}
            submit={submitForm}
          />
          {snapshot.stage === 'payment_required' &&
            snapshot.executionEnabled &&
            s?.bookingReference && (
              <OxygenPaymentRecovery
                workflowId={snapshot.workflowId}
                reference={s.bookingReference}
                version={snapshot.version}
                autoOpen={approval.autoOpenReference === s.bookingReference}
                planState={s}
                statusError={Boolean(error)}
                onCheckStatus={clearError}
                products={products}
                active={active}
                parentBusy={busy}
                readSaved={readSaved}
              />
            )}
          {snapshot.stage === 'ready_for_activation' &&
            (s?.bookingReference && s.paymentComplete && s.setupComplete ? (
              <OxygenPaymentCompletion
                reference={s.bookingReference}
                plan={s}
                products={products}
                active={active}
                busy={busy}
                readSaved={readSaved}
              />
            ) : (
              <p role="status">We’re confirming your payment details.</p>
            ))}
        </>
      )}
    </section>
  );
}
