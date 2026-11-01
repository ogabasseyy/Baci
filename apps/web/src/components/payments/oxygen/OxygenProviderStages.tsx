'use client';
import type { Dispatch, SetStateAction } from 'react';
import {
  type OxygenJourneyStage,
  trackOxygenJourney,
} from '@/lib/payments/oxygen/journey-events';
import type { OxygenCustomerPrefill } from '@/schemas/oxygen-customer-prefill';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenAddressProgress } from './OxygenAddressProgress';
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
import { OxygenVerificationForms } from './OxygenVerificationForms';
import type { submitOxygenVerificationForm } from './submit-oxygen-verification-form';
import type { useOxygenApprovedPayment } from './use-oxygen-approved-payment';
import type { useOxygenBookingProgress } from './use-oxygen-booking-progress';
import type { useOxygenProvider } from './use-oxygen-provider';
import type { useOxygenResidentialContext } from './use-oxygen-residential-context';
import type { useOxygenResidentialSubmission } from './use-oxygen-residential-submission';

type Provider = ReturnType<typeof useOxygenProvider>;
type Props = {
  snapshot: OxygenRuntimeSnapshot;
  flow: {
    orderId: string;
    productAmount?: number;
    products?: OxygenCheckoutProduct[];
    currency?: string;
    prefill?: OxygenCustomerPrefill;
    active: boolean;
    onProgress?: (stage: OxygenJourneyStage) => void;
  };
  view: {
    disabled: boolean;
    busy: boolean;
    error: string;
    activeLoanError: boolean;
    phoneError: string;
    replacingAddress: boolean;
    addressWaiting: boolean;
    comparingPlans: boolean;
    acceptedPlanReference?: string;
  };
  actions: {
    submit: Provider['submit'];
    submitForm: ReturnType<typeof submitOxygenVerificationForm>;
    readSaved: Provider['readSaved'];
    clearError: Provider['clearError'];
    setReplacingAddress: Dispatch<SetStateAction<boolean>>;
    setComparingPlans: Dispatch<SetStateAction<boolean>>;
  };
  approval: ReturnType<typeof useOxygenApprovedPayment>;
  bookingProgress: ReturnType<typeof useOxygenBookingProgress>;
  residentialContext: ReturnType<typeof useOxygenResidentialContext>;
  residential: ReturnType<typeof useOxygenResidentialSubmission>;
};
export function OxygenProviderStages({
  snapshot,
  flow,
  view,
  actions,
  approval,
  bookingProgress,
  residentialContext,
  residential,
}: Props) {
  const {
    orderId,
    productAmount,
    products,
    currency,
    prefill,
    active,
    onProgress,
  } = flow;
  const {
    disabled,
    busy,
    error,
    activeLoanError,
    phoneError,
    replacingAddress,
    addressWaiting,
    comparingPlans,
    acceptedPlanReference,
  } = view;
  const {
    submit,
    submitForm,
    readSaved,
    clearError,
    setReplacingAddress,
    setComparingPlans,
  } = actions;
  const s = snapshot.state;
  return (
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
        ) && <OxygenProductSummary products={products} currency={currency} />}
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
  );
}
