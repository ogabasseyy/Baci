'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  orderRefundMethodLabels,
  orderRefundStatusLabels,
} from '@/config/order-refund';
import { apiPost } from '@/lib/api-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { describeRefundManageBlocked } from '@/lib/orders/describe-refund-manage-blocked';
import { describeRefundWorkerError } from '@/lib/orders/describe-refund-worker-error';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { toLagosRefundInstant } from '@/lib/orders/to-lagos-refund-instant';
import { validateManualRefundInput } from '@/lib/orders/validate-manual-refund-input';
import { OrderRefundManualForm } from './order-refund-manual-form';
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
        reference,
        remaining: summary?.remaining ?? null,
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
          : {
              action,
              amount: Number(amount),
              refundedAt: toLagosRefundInstant(date),
              method,
              reference,
              note,
              confirmed,
            };
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
              {orderRefundStatusLabels[summary.status]}
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
              <p className="text-sm text-destructive">
                {describeRefundWorkerError(summary.error)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Attempts in current cycle: {summary.attempts}. Retries requested:{' '}
              {summary.retryRequests}.
            </p>
            {summary.status === 'requires_review' && (
              <p className="text-sm">
                {summary.error?.toLowerCase().includes('paystack')
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
                        setAmount(String(summary.remaining));
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
                method={method}
                note={note}
                onAmountChange={setAmount}
                onConfirmedChange={setConfirmed}
                onDateChange={setDate}
                onMethodChange={setMethod}
                onNoteChange={setNote}
                onReferenceChange={setReference}
                onSubmit={() => void submit('manual')}
                reference={reference}
                remaining={summary.remaining}
              />
            )}
            {summary.events && summary.events.length > 0 && (
              <details>
                <summary>Refund activity</summary>
                <ul className="space-y-2 text-sm" aria-label="Refund activity">
                  {summary.events.map((event) => {
                    // Worker strings never render verbatim here either:
                    // Fixed labels only: raw worker/provider text stays
                    // out of the DOM like the route's error masking.
                    const eventError =
                      event.details.error || event.details.previousError;
                    return (
                      <li key={event.id}>
                        <p>
                          {orderRefundStatusLabels[event.action] ||
                            'Refund activity'}{' '}
                          · {new Date(event.date).toLocaleString()}
                        </p>
                        {eventError && (
                          <p>{describeRefundWorkerError(eventError)}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            {summary.history.length > 0 && (
              <ul className="space-y-2 text-sm" aria-label="Refund history">
                {summary.history.map((item) => (
                  <li key={item.id} className="border-t pt-2">
                    <p>
                      {money(item.amount)} ·{' '}
                      {orderRefundStatusLabels[item.status] ?? item.status} ·{' '}
                      {orderRefundMethodLabels[item.method] ?? item.method}
                    </p>
                    <p className="break-all">{item.reference}</p>
                    <p>{new Date(item.date).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
