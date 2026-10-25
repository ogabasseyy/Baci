'use client';
import { useEffect, useState } from 'react';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { OxygenApprovalCode } from './OxygenApprovalCode';
import { OxygenComparisonSummary } from './OxygenComparisonSummary';
import summaryStyles from './OxygenComparisonSummary.module.css';
import { OxygenDownPayment } from './OxygenDownPayment';
import { OxygenLoanSummary } from './OxygenLoanSummary';
import { OxygenTenurePicker } from './OxygenTenurePicker';
import { oxygenButtonClass } from './oxygen-checkout-styles';
import { useOxygenSavedPlans } from './use-oxygen-saved-plans';

export function OxygenSavedPlans({
  workflowId,
  state,
  onReady,
  approvalReference,
  requestApprovalCode,
  approvePlan,
  approvalBusy = false,
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
}) {
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
  const tenures = Array.from({ length: maxTenure }, (_, i) => i + 1);
  function requestPlan(
    value: number | null,
    months = tenure,
    updateSelection = true
  ) {
    if (value === null || quoting) return;
    if (updateSelection) choose(value, months);
    if (!plans.some((p) => p.equityPercentage === value && p.tenure === months))
      void quote(value, months);
  }
  const percentages = [...new Set(plans.map((p) => p.equityPercentage))];

  if (approvalReference && approvalReference === state.bookingReference) {
    return (
      <OxygenApprovalCode
        key={`${workflowId}:${approvalReference}`}
        workflowId={workflowId}
        reference={approvalReference}
        state={state}
        requestCode={requestApprovalCode}
        approvePlan={approvePlan}
        busy={approvalBusy}
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
            disabled={quoting}
            onCommit={(value) => requestPlan(value, tenure, false)}
          />
          <OxygenTenurePicker
            months={tenures}
            value={tenure}
            disabled={quoting}
            onChange={(months) => requestPlan(percentage, months)}
          />
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
      {ready && (
        <div className={summaryStyles.footer}>
          {confirmed && (
            <p role="status">
              No approval will be submitted when requesting a code.
            </p>
          )}
          <button
            type="button"
            className={oxygenButtonClass}
            disabled={
              quoting ||
              percentage === null ||
              Boolean(error) ||
              (Boolean(confirmed) &&
                (!requestApprovalCode ||
                  confirmed?.bookingReference !== state.bookingReference)) ||
              approvalBusy
            }
            onClick={() => {
              if (!confirmed) requestPlan(percentage);
              else if (confirmed.bookingReference === state.bookingReference)
                void requestApprovalCode?.(confirmed.bookingReference);
            }}
          >
            {quoting
              ? 'Updating…'
              : !confirmed
                ? 'Show my plan'
                : 'Request approval code'}
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
