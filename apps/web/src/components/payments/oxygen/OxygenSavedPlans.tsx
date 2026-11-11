'use client';
import { useEffect, useState } from 'react';
import { bookedPlanIsOffered } from '@/lib/payments/oxygen/booked-plan-offer';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenApprovalCode } from './OxygenApprovalCode';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import summaryStyles from './OxygenComparisonSummary.module.css';
import { OxygenDownPayment } from './OxygenDownPayment';
import { OxygenLoanSummary } from './OxygenLoanSummary';
import { OxygenTenurePicker } from './OxygenTenurePicker';
import { oxygenButtonClass } from './oxygen-checkout-styles';
import { oxygenPlanLimits } from './plan-limits';
import { useOxygenSavedPlans } from './use-oxygen-saved-plans';

export function OxygenSavedPlans({
  workflowId,
  state,
  onReady,
  approvalReference,
  requestApprovalCode,
  approvePlan,
  approvalBusy = false,
  resumeQueuedApproval = false,
  onAccept,
  refreshOffers,
  approvalCodeStarted = false,
}: {
  workflowId: string;
  state: OxygenProviderState;
  onReady?: (ready: boolean) => void;
  approvalReference?: string;
  requestApprovalCode?: (reference: string) => Promise<boolean>;
  approvePlan?: (
    reference: string,
    otp: string,
    signature: File,
    onConfirmed?: () => Promise<void>
  ) => Promise<boolean>;
  approvalBusy?: boolean;
  resumeQueuedApproval?: boolean;
  onAccept?: (reference: string) => void;
  refreshOffers?: () => Promise<boolean>;
  approvalCodeStarted?: boolean;
}) {
  const [signingReference, setSigningReference] = useState<string>();
  const { data, selected, error, select, reload, quote, quoting } =
    useOxygenSavedPlans(workflowId);
  const plans =
    data?.plans.filter(
      (p) => p.productAmount === state.booking?.product_amount
    ) ?? [];
  const chosen =
    plans.find((p) => p.bookingReference === selected) ??
    plans.find((p) => p.bookingReference === state.bookingReference) ??
    plans[0];
  const [draftPercentage, setDraftPercentage] = useState<
    number | null | undefined
  >();
  const [draftTenure, setDraftTenure] = useState<number | undefined>();
  const percentage =
    draftPercentage === undefined
      ? (chosen?.equityPercentage ?? null)
      : draftPercentage;
  const tenure = draftTenure ?? chosen?.tenure ?? 3;
  const confirmed = plans.find(
    (p) => p.equityPercentage === percentage && p.tenure === tenure
  );
  function choose(value: number | null, months = tenure) {
    setDraftPercentage(value);
    setDraftTenure(months);
    const match = plans.find(
      (p) => p.equityPercentage === value && p.tenure === months
    );
    if (match && match.bookingReference !== selected)
      void select(match.bookingReference);
  }
  const ready = plans.length > 0;
  useEffect(() => {
    onReady?.(ready);
  }, [ready, onReady]);
  const maxTenure = Math.min(
    12,
    state.maxTenure ?? Math.max(1, ...plans.map((p) => p.tenure))
  );
  const tenures = [
    ...new Set([
      ...(state.offers?.map((offer) => offer.tenure) ?? []),
      ...plans.map((plan) => plan.tenure),
    ]),
  ]
    .filter((month) => month <= maxTenure)
    .sort((a, b) => a - b);
  function offered(value: number | null, months: number) {
    const offer = state.offers?.find((item) => item.tenure === months);
    const limit = oxygenPlanLimits(
      chosen?.productAmount,
      offer && state.eligibleAmount !== undefined
        ? Math.min(offer.loanAmount, state.eligibleAmount)
        : undefined,
      state.minimumAmount
    );
    return (
      value !== null &&
      limit.kind === 'available' &&
      value >= limit.min &&
      value <= limit.max
    );
  }
  function requestPlan(
    value: number | null,
    months = tenure,
    updateSelection = true
  ) {
    if (value === null || quoting) return;
    if (updateSelection) choose(value, months);
    if (
      !plans.some((p) => p.equityPercentage === value && p.tenure === months) &&
      offered(value, months)
    )
      void quote(value, months);
  }
  const percentages = [...new Set(plans.map((p) => p.equityPercentage))];

  const approvalPlan = approvalReference ?? signingReference;
  if (
    approvalPlan &&
    approvalPlan === state.bookingReference &&
    bookedPlanIsOffered(state)
  ) {
    return (
      <OxygenApprovalCode
        key={`${workflowId}:${approvalPlan}`}
        workflowId={workflowId}
        reference={approvalPlan}
        state={state}
        requestCode={requestApprovalCode}
        approvePlan={approvePlan}
        busy={approvalBusy}
        resumeQueuedApproval={resumeQueuedApproval}
      />
    );
  }
  return (
    <section className="grid gap-4" aria-label="Saved payment plans">
      {plans.length > 0 && chosen && (
        <>
          <header className="pr-12">
            <h3 className="text-lg font-bold">Choose your payment plan</h3>
            <p className="text-sm text-gray-500">
              Set your down payment. Compare the plan below.
            </p>
          </header>
          <OxygenDownPayment
            productAmount={chosen.productAmount}
            percentage={percentage}
            extraPercentages={percentages}
            onChange={choose}
            disabled={quoting || approvalCodeStarted}
            onCommit={(value) => requestPlan(value, tenure, false)}
          />
          <OxygenTenurePicker
            months={tenures}
            value={tenure}
            disabled={quoting || approvalCodeStarted}
            onChange={(months) => requestPlan(percentage, months)}
          />
          {!confirmed && !offered(percentage, tenure) && (
            <p role="status">
              {state.offers
                ? 'Adjust your down payment or choose an available repayment period to see another plan.'
                : 'Your saved plan is available. New payment options are temporarily unavailable.'}
            </p>
          )}
        </>
      )}
      {!ready ? (
        data === null && !error ? (
          <OxygenComparisonSummary loading tenure={tenure} />
        ) : (
          <OxygenLoanSummary state={state} />
        )
      ) : (
        <OxygenComparisonSummary
          state={confirmed?.state}
          loading={quoting}
          tenure={tenure}
        />
      )}
      {!state.offers && refreshOffers && (
        <div className="grid gap-2 text-sm">
          <p>
            Update your payment options to check your saved plan before
            continuing.
          </p>
          <button
            type="button"
            className="min-h-11 font-semibold text-store-primary underline"
            disabled={approvalBusy || quoting}
            onClick={() => void refreshOffers()}
          >
            Update payment options
          </button>
        </div>
      )}
      {state.offers && confirmed && !offered(percentage, tenure) && (
        <p role="status">
          {approvalCodeStarted
            ? 'We could not confirm this saved plan. Please contact support for help.'
            : 'This saved plan is no longer available. Choose another down payment or repayment period.'}
        </p>
      )}
      {ready && (
        <div className={summaryStyles.footer}>
          {confirmed && (
            <p role="status">
              {onAccept
                ? 'Review your selected plan before continuing.'
                : 'Sign and accept your plan next. Your email code will confirm approval.'}
            </p>
          )}
          <button
            type="button"
            className={oxygenButtonClass}
            disabled={
              quoting ||
              percentage === null ||
              Boolean(error) ||
              (!confirmed && !offered(percentage, tenure)) ||
              (Boolean(confirmed) && !offered(percentage, tenure)) ||
              (Boolean(confirmed) &&
                ((!onAccept && !requestApprovalCode) ||
                  (!onAccept &&
                    confirmed?.bookingReference !== state.bookingReference))) ||
              approvalBusy
            }
            onClick={() => {
              if (!confirmed) requestPlan(percentage);
              else if (
                onAccept ||
                confirmed.bookingReference === state.bookingReference
              )
                onAccept
                  ? onAccept(confirmed.bookingReference)
                  : setSigningReference(confirmed.bookingReference);
            }}
          >
            {quoting
              ? 'Updating…'
              : !confirmed
                ? 'Show my plan'
                : onAccept
                  ? 'Accept payment plan'
                  : 'Continue'}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="grid gap-2 text-sm">
          <p>{error}</p>
          <button
            type="button"
            className="min-h-11 underline"
            onClick={() => {
              if (!confirmed && percentage !== null) requestPlan(percentage);
              else if (selected) void select(selected);
              else void reload();
            }}
            disabled={quoting}
          >
            Retry plan breakdown
          </button>
        </div>
      )}
    </section>
  );
}
