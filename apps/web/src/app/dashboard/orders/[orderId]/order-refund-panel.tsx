'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { orderRefundStatusLabels } from '@/config/order-refund';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { describeRefundManageBlocked } from '@/lib/orders/describe-refund-manage-blocked';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { selectRefundPinLegOptions } from '@/lib/orders/select-refund-pin-leg-options';
import { normalizePaymentGateway } from '@/lib/payments/normalize-payment-gateway';
import { OrderRefundManualForm } from './order-refund-manual-form';
import { OrderRefundTimeline } from './order-refund-timeline';
import { useOrderRefundSubmit } from './use-order-refund-submit';
import { useRefundPinAmountCap } from './use-refund-pin-amount-cap';
import { useRefundStatusPolling } from './use-refund-status-polling';

export function OrderRefundPanel({
  initialSummary,
  orderId,
  onRefunded,
}: {
  initialSummary?: RefundSummary;
  orderId: string;
  onRefunded?: () => void;
}) {
  const revision = useRef(0);
  // First paint comes from the server-fetched summary when the page
  // provided one: no mount-fetch flash, and the 30s polling below
  // still refreshes it. Without one (server fetch failed) the hook
  // loads client-side exactly as before.
  const [summary, setSummary] = useState<RefundSummary | null>(
    initialSummary ?? null
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [legId, setLegId] = useState('');
  // Several outstanding captures force a Paystack pin choice; a
  // sole leg stays unpinned for the RPC to resolve on live data.
  const legOptions = selectRefundPinLegOptions(
    summary?.legs ?? [],
    summary?.currency ?? 'NGN'
  );
  const requireLeg = method === 'paystack' && legOptions.length > 1;
  // The RPC needs an outstanding Paystack capture for a Paystack
  // attestation (exactly one when unpinned): without one the
  // selection always rejects, so the form hides the method instead
  // of offering a recovery path that can never succeed.
  const hasPaystackCapture = (summary?.legs ?? []).some(
    (leg) =>
      normalizePaymentGateway(leg.gateway) === 'PAYSTACK' && leg.outstanding > 0
  );
  // A polling update can cover the pinned capture while the form
  // stands open: the selector hides but the stale id would still
  // submit and the RPC would reject it. Only a pin that remains a
  // live option reaches validation and the payload; anything else
  // resolves unpinned like a sole leg.
  const pinnedLegId = legOptions.some((option) => option.id === legId)
    ? legId
    : null;
  const { effectiveRemaining, handleLegIdChange, handleMethodChange } =
    useRefundPinAmountCap({
      amount,
      legOptions,
      legs: summary?.legs ?? [],
      method,
      pinnedLegId,
      remaining: summary?.remaining ?? null,
      setAmount,
      setLegId,
      setMethod,
    });

  // Only a refunded order without a Paystack payment is terminal:
  // other rows can still transition asynchronously (drain retries,
  // provider reconciliation), and the ledger-derived balance would
  // go stale without the poll. A refunded Paystack-backed order is
  // settled but still watched: a later contradictory provider
  // verdict can re-open the balance, so those pages keep a slow
  // bounded watch past refunded instead of the 30s poll. The flag
  // (not the outstanding-leg list, which empties exactly at full
  // refund) carries the provider-backed signal.
  const terminal =
    summary?.status === 'refunded' && !summary?.hasPaystackPayment;
  const settledWatch =
    summary?.status === 'refunded' && summary?.hasPaystackPayment === true;
  useRefundStatusPolling({
    hasInitialSummary: initialSummary !== undefined,
    onError: setError,
    onSummary: setSummary,
    orderId,
    revision,
    settledWatch,
    terminal,
  });

  // The parent passes an inline callback, so its identity changes on
  // every parent render: fire the completion callback once per order.
  const refundedFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (
      summary?.status === 'refunded' &&
      refundedFiredFor.current !== orderId
    ) {
      refundedFiredFor.current = orderId;
      onRefunded?.();
    }
  }, [summary?.status, orderId, onRefunded]);

  // Recording needs both the manage capability and the manual flag,
  // mirroring the action-button visibility below.
  const canRecordManual =
    summary?.canManageRefunds === true && summary?.canRecordManual === true;
  // Polling can revoke recording while the form stands open (a
  // provider refund started, the step was claimed, or the order went
  // terminal): close and clear the stale form instead of letting the
  // merchant follow guidance the server now rejects.
  useEffect(() => {
    if (!canRecordManual) {
      setShowForm(false);
      setConfirmed(false);
      setReference('');
      setDate('');
      setNote('');
      setLegId('');
    }
  }, [canRecordManual]);
  // Polling can cover the last Paystack capture while the form
  // stands open: fall back to bank transfer instead of submitting
  // a method the RPC now rejects.
  useEffect(() => {
    if (method === 'paystack' && !hasPaystackCapture) {
      setMethod('bank_transfer');
    }
  }, [method, hasPaystackCapture]);

  const submit = useOrderRefundSubmit({
    amount,
    busy,
    confirmed,
    date,
    effectiveRemaining,
    method,
    note,
    orderId,
    pinnedLegId,
    reference,
    requireLeg,
    revision,
    setBusy,
    setConfirmed,
    setDate,
    setError,
    setLegId,
    setNote,
    setReference,
    setShowForm,
    setSummary,
  });
  const money = (value: number) =>
    formatDisplayCurrency(value, summary?.currency || 'NGN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Refund</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!summary ? (
          <p role="status">
            {error ? 'Refund status unavailable.' : 'Loading refund…'}
          </p>
        ) : (
          <>
            <p role="status" className="font-semibold">
              {orderRefundStatusLabels[summary.status] ?? summary.status}
            </p>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt>Amount paid</dt>
                <dd>{money(summary.amountPaid)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Refunded</dt>
                <dd>{money(summary.refunded)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Remaining</dt>
                <dd>{money(summary.remaining)}</dd>
              </div>
              {(summary.reversedInternal ?? 0) > 0 && (
                <div className="flex justify-between">
                  <dt>Returned to wallet/savings</dt>
                  <dd>{money(summary.reversedInternal ?? 0)}</dd>
                </div>
              )}
            </dl>
            {summary.error && (
              <p className="text-sm text-destructive">{summary.error}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Attempts in current cycle: {summary.attempts}. Retries requested:{' '}
              {summary.retryRequests}.
            </p>
            {summary.status === 'requires_review' && (
              <p className="text-sm">
                {summary.needsPaystackCheck
                  ? 'Verify the existing refund in Paystack before taking further action.'
                  : 'Review the flagged refund details before taking further action.'}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {summary.canManageRefunds === false ? (
                <p className="text-sm text-muted-foreground">
                  {describeRefundManageBlocked(summary.status)}
                </p>
              ) : (
                <>
                  {summary.canRetry && (
                    <Button
                      disabled={busy}
                      onClick={() => void submit('retry')}
                    >
                      Retry refund
                    </Button>
                  )}
                  {summary.canRecordManual && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setConfirmed(false);
                        // Two-decimal string: a raw float conversion can
                        // carry binary artifacts (0.30000000000000004)
                        // that fail the panel's own decimal guard.
                        // Prefill the effective cap, not the remainder:
                        // a retained Paystack method keeps its capture
                        // ceiling, and no leg change fires to snap an
                        // over-cap prefill on reopen.
                        setAmount(
                          (effectiveRemaining ?? summary.remaining).toFixed(2)
                        );
                        setShowForm(!showForm);
                      }}
                    >
                      Record manual refund
                    </Button>
                  )}
                </>
              )}
            </div>
            {showForm && canRecordManual && (
              <OrderRefundManualForm
                amount={amount}
                busy={busy}
                confirmed={confirmed}
                currency={summary.currency}
                date={date}
                legId={pinnedLegId ?? ''}
                legOptions={requireLeg ? legOptions : []}
                method={method}
                note={note}
                onAmountChange={setAmount}
                onConfirmedChange={setConfirmed}
                onDateChange={setDate}
                onLegIdChange={handleLegIdChange}
                onMethodChange={handleMethodChange}
                onNoteChange={setNote}
                onReferenceChange={setReference}
                onSubmit={() => void submit('manual')}
                paystackAvailable={hasPaystackCapture}
                reference={reference}
                remaining={effectiveRemaining ?? summary.remaining}
              />
            )}
            <OrderRefundTimeline
              currency={summary.currency}
              events={summary.events ?? []}
              history={summary.history}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
