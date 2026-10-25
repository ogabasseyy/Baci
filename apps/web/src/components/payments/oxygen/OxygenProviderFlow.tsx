'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { oxygenActiveLoanMessage } from '@/lib/payments/oxygen/booking-rejection';
import { oxygenCustomerStep } from '@/lib/payments/oxygen/customer-step';
import {
  type OxygenJourneyStage,
  trackOxygenJourney,
} from '@/lib/payments/oxygen/journey-events';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import { OxygenApplicationError } from './OxygenApplicationError';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenConfirmationNotice } from './OxygenConfirmationNotice';
import { OxygenCustomerForm } from './OxygenCustomerForm';
import { OxygenGuidedVerification } from './OxygenGuidedVerification';
import { OxygenLoanSummary } from './OxygenLoanSummary';
import { OxygenPaymentRecovery } from './OxygenPaymentRecovery';
import { OxygenPaymentSuccess } from './OxygenPaymentSuccess';
import { OxygenCheckoutCloseContext } from './OxygenPaymentSurfaceContext';
import { OxygenPlanForm } from './OxygenPlanForm';
import { OxygenPreviousApprovalStep } from './OxygenPreviousApprovalStep';
import {
  type OxygenCheckoutProduct,
  OxygenProductSummary,
} from './OxygenProductSummary';
import { OxygenSavedPlans } from './OxygenSavedPlans';
import { OxygenSelfieButton } from './OxygenSelfieButton';
import { OxygenSignIn } from './OxygenSignIn';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { OxygenVerificationForms } from './OxygenVerificationForms';
import { useOxygenBookingProgress } from './use-oxygen-booking-progress';
import { useOxygenConfirmationUpdates } from './use-oxygen-confirmation-updates';
import { useOxygenProvider } from './use-oxygen-provider';
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
    needsSignIn,
  } = useOxygenProvider(orderId);
  const selfieConfirmed = useOxygenSelfieHandoff(
    snapshot,
    active,
    busy,
    submit,
    refresh
  );
  const closeCheckout = useContext(OxygenCheckoutCloseContext);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void refresh();
    wasActive.current = active;
  }, [active, refresh]);
  const s = snapshot?.state;
  const [comparingPlans, setComparingPlans] = useState(false);
  const [submittedAddressFor, setSubmittedAddressFor] = useState<string | null>(
    null
  );
  const addressWaiting = Boolean(
    s?.bookingReference &&
      (submittedAddressFor === s.bookingReference ||
        s.kyc?.address_status === 'PROCESSING')
  );
  useOxygenBookingProgress(
    snapshot,
    busy,
    error,
    active,
    addressWaiting,
    submit
  );
  const submitForm: SubmitOxygenForm = async (command, file) => {
    const acknowledged = await submit(command, file);
    if (
      acknowledged &&
      command.action === 'submit_address' &&
      s?.bookingReference
    )
      setSubmittedAddressFor(s.bookingReference);
    return acknowledged;
  };
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
        <OxygenPaymentRecovery
          workflowId={snapshot.workflowId}
          reference={s.bookingReference}
          version={snapshot.version}
          approvalUnconfirmed
          planState={s}
          products={products}
          previousStep={<OxygenPreviousApprovalStep state={s} />}
        />
      </div>
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
  return (
    <section
      className="space-y-5 p-6 pt-0"
      aria-label="Oxygen finance application"
    >
      {(error || activeLoanError) && !phoneError && !needsSignIn && (
        <OxygenApplicationError
          activeLoan={activeLoanError}
          retryBreakdown={
            errorAction === 'refresh_details' && !snapshot?.pending
          }
          error={error}
          validated={s?.validated}
          stage={snapshot?.stage}
          merchantSlug={merchantSlug}
          busy={busy}
          refresh={
            errorAction === 'refresh_details' && !snapshot?.pending
              ? async () => {
                  await submit({ action: 'refresh_details' });
                }
              : refresh
          }
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
          {snapshot.stage === 'application_required' && (
            <OxygenCustomerForm
              workflowId={snapshot.workflowId}
              prefill={prefill}
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
          {s?.booking && products && (
            <OxygenProductSummary products={products} currency={currency} />
          )}
          {s?.booking &&
            (s.booking.status === 'BOOKED' ? (
              <OxygenSavedPlans
                key={snapshot.workflowId}
                workflowId={snapshot.workflowId}
                state={s}
                onReady={setComparingPlans}
                approvalReference={
                  snapshot.approvalOtpReady ? s.bookingReference : undefined
                }
                approvePlan={async (reference, otp, signature, onConfirmed) => {
                  if (
                    reference !== s.bookingReference ||
                    !snapshot.executionEnabled ||
                    disabled ||
                    snapshot.stage !== 'approval_required'
                  )
                    return false;
                  return await submit(
                    { action: 'approve_booking', otp, accepted: true },
                    signature,
                    onConfirmed
                  );
                }}
                approvalBusy={disabled}
                requestApprovalCode={async (reference) => {
                  if (
                    reference !== s.bookingReference ||
                    !snapshot.executionEnabled ||
                    disabled
                  )
                    return false;
                  return await submit({ action: 'trigger_approval_otp' });
                }}
              />
            ) : (
              <OxygenLoanSummary state={s} />
            ))}
          {snapshot.stage === 'booked' && addressWaiting && (
            <div
              role="status"
              className="mx-auto max-w-md space-y-3 py-6 text-center"
            >
              <h3 className="text-xl font-bold text-gray-900">
                Your address is under review
              </h3>
              <p className="text-sm leading-relaxed text-gray-500">
                Your document has been submitted. We’ll check for Oxygen’s
                confirmation automatically. You can return to this application
                later.
              </p>
            </div>
          )}
          <OxygenVerificationForms
            stage={
              snapshot.stage === 'approval_required' &&
              (comparingPlans || s?.booking?.status === 'BOOKED')
                ? 'plan_comparison'
                : snapshot.stage === 'eligibility_required' && s?.validated
                  ? 'phone_complete'
                  : snapshot.stage === 'booked' && addressWaiting
                    ? 'address_review'
                    : snapshot.stage
            }
            address={snapshot.checkoutAddress}
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
                planState={s}
                products={products}
              />
            )}
          {snapshot.stage === 'ready_for_activation' &&
            (s?.bookingReference && s.paymentComplete && s.setupComplete ? (
              <OxygenPaymentSuccess
                reference={s.bookingReference}
                plan={s}
                products={products}
                onDone={closeCheckout}
              />
            ) : (
              <p role="status">We’re confirming your payment details.</p>
            ))}
        </>
      )}
    </section>
  );
}
