'use client';
import { useEffect, useRef, useState } from 'react';
import { oxygenActiveLoanMessage } from '@/lib/payments/oxygen/booking-rejection';
import { oxygenCustomerStep } from '@/lib/payments/oxygen/customer-step';
import { trackOxygenJourney } from '@/lib/payments/oxygen/journey-events';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenBookedPlanReview } from './OxygenBookedPlanReview';
import { OxygenCompletedApplication } from './OxygenCompletedApplication';
import { OxygenPendingConfirmation } from './OxygenPendingConfirmation';
import { OxygenProductSummary } from './OxygenProductSummary';
import { OxygenProviderStages } from './OxygenProviderStages';
import { OxygenSignIn } from './OxygenSignIn';
import { OxygenWorkflowError } from './OxygenWorkflowError';
import type { OxygenProviderFlowProps } from './oxygen-provider-flow-types';
import { submitOxygenVerificationForm } from './submit-oxygen-verification-form';
import { useOxygenApprovedPayment } from './use-oxygen-approved-payment';
import { useOxygenBookingProgress } from './use-oxygen-booking-progress';
import { useOxygenConfirmationUpdates } from './use-oxygen-confirmation-updates';
import { useOxygenPlanAcceptance } from './use-oxygen-plan-acceptance';
import { useOxygenProvider } from './use-oxygen-provider';
import { useOxygenResidentialContext } from './use-oxygen-residential-context';
import { useOxygenResidentialSubmission } from './use-oxygen-residential-submission';
import { useOxygenSavedUpdates } from './use-oxygen-saved-updates';
import { useOxygenSelfieHandoff } from './use-oxygen-selfie-handoff';

export function OxygenProviderFlow({
  orderId,
  merchantSlug,
  productAmount,
  products,
  currency,
  prefill,
  active = true,
  onProgress,
}: OxygenProviderFlowProps) {
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
}: OxygenProviderFlowProps) {
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
  const acceptance = useOxygenPlanAcceptance();
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
  if (awaitingConfirmation && !needsSignIn)
    return (
      <OxygenPendingConfirmation
        snapshot={snapshot}
        awaitingConfirmation={awaitingConfirmation}
        needsSignIn={needsSignIn}
        busy={busy}
        error={error}
        refresh={refresh}
        selfieConfirmed={selfieConfirmed}
        setComparingPlans={setComparingPlans}
      />
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
        {acceptance.error && <p role="alert">{acceptance.error}</p>}
        <OxygenBookedPlanReview
          key={s.bookingReference}
          workflowId={snapshot.workflowId}
          state={s}
          busy={disabled || acceptance.busy}
          onAccept={(reference) => {
            void acceptance
              .accept(snapshot.workflowId, reference, readSaved)
              .then((confirmed) => {
                if (confirmed) setAcceptedPlanReference(reference);
              });
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
        <OxygenProviderStages
          snapshot={snapshot}
          flow={{
            orderId,
            productAmount,
            products,
            currency,
            prefill,
            active,
            onProgress,
          }}
          view={{
            disabled,
            busy,
            error,
            activeLoanError,
            phoneError,
            replacingAddress,
            addressWaiting,
            comparingPlans,
            acceptedPlanReference,
          }}
          actions={{
            submit,
            submitForm,
            readSaved,
            clearError,
            setReplacingAddress,
            setComparingPlans,
          }}
          approval={approval}
          bookingProgress={bookingProgress}
          residentialContext={residentialContext}
          residential={residential}
        />
      )}
    </section>
  );
}
