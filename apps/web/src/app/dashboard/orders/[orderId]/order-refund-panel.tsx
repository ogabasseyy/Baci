'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { orderRefundStatusLabels } from '@/config/order-refund';
import { apiPost } from '@/lib/api-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { buildManualRefundPayload } from '@/lib/orders/build-manual-refund-payload';
import { describeRefundManageBlocked } from '@/lib/orders/describe-refund-manage-blocked';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { selectRefundPinLegOptions } from '@/lib/orders/select-refund-pin-leg-options';
import { validateManualRefundInput } from '@/lib/orders/validate-manual-refund-input';
import { OrderRefundManualForm } from './order-refund-manual-form';
import { OrderRefundTimeline } from './order-refund-timeline';
import { useRefundStatusPolling } from './use-refund-status-polling';

export function OrderRefundPanel({
  orderId,
  onRefunded,
}: {
  orderId: string;
  onRefunded?: () => void;
}) {
  const revision = useRef(0);
  const [summary, setSummary] = useState<RefundSummary | null>(null);
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

  // Only a refunded order is terminal: a failed row can still
  // transition asynchronously (drain retries, provider
  // reconciliation), and the ledger-derived balance would go stale
  // without the poll.
  const terminal = summary?.status === 'refunded';
  useRefundStatusPolling({
    onError: setError,
    onSummary: setSummary,
    orderId,
    revision,
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

  async function submit(action: 'retry' | 'manual') {
    if (busy) return;
    if (
      action === 'retry' &&
      !window.confirm(
        'Retry the remaining refund? Fund your Paystack balance first.'
      )
    )
      return;
    if (action === 'manual') {
      const validationError = validateManualRefundInput({
        amount,
        confirmed,
        date,
        method,
        paymentLegId: legId || null,
        reference,
        remaining: summary?.remaining ?? null,
        requirePaymentLeg: requireLeg,
      });
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    revision.current += 1;
    setBusy(true);
    setError(null);
    try {
      const payload =
        action === 'retry'
          ? { action }
          : buildManualRefundPayload({
              amount,
              confirmed,
              date,
              method,
              note,
              paymentLegId: legId || null,
              reference,
            });
      const updated = await apiPost<RefundSummary>(
        `/api/orders/${encodeURIComponent(orderId)}/refund`,
        payload
      );
      setSummary(updated);
      setShowForm(false);
      setConfirmed(false);
      // Transfer-specific fields must not carry into the next record:
      // reopening the form after a partial manual would otherwise
      // resubmit the old reference and collide (or replay idempotently
      // when amount and timestamp also match).
      setReference('');
      setDate('');
      setNote('');
      setLegId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to manage refund');
    } finally {
      revision.current += 1;
      setBusy(false);
    }
  }
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
                        setAmount(summary.remaining.toFixed(2));
                        setShowForm(!showForm);
                      }}
                    >
                      Record manual refund
                    </Button>
                  )}
                </>
              )}
            </div>
            {showForm && (
              <OrderRefundManualForm
                amount={amount}
                busy={busy}
                confirmed={confirmed}
                currency={summary.currency}
                date={date}
                legId={legId}
                legOptions={requireLeg ? legOptions : []}
                method={method}
                note={note}
                onAmountChange={setAmount}
                onConfirmedChange={setConfirmed}
                onDateChange={setDate}
                onLegIdChange={setLegId}
                onMethodChange={(value) => {
                  setMethod(value);
                  setLegId('');
                }}
                onNoteChange={setNote}
                onReferenceChange={setReference}
                onSubmit={() => void submit('manual')}
                reference={reference}
                remaining={summary.remaining}
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
