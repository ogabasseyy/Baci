'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  describeRefundWorkerError,
  orderRefundStatusLabels,
} from '@/config/order-refund';
import { apiPost } from '@/lib/api-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { OrderRefundManualForm } from './order-refund-manual-form';

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

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      const startedRevision = revision.current;
      try {
        const response = await fetch(
          `/api/orders/${encodeURIComponent(orderId)}/refund`,
          {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'include',
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(data.error || 'Unable to load refund');
        if (active && startedRevision === revision.current) {
          setSummary(data);
          setError(null);
        }
      } catch (e) {
        if (
          active &&
          startedRevision === revision.current &&
          !controller.signal.aborted
        )
          setError(e instanceof Error ? e.message : 'Unable to load refund');
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [orderId]);

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
      const parsedAmount = Number(amount);
      const parsedDate = new Date(date);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setError('Enter a valid refund amount greater than zero.');
        return;
      }
      if (Number.isNaN(parsedDate.getTime())) {
        setError('Enter a valid refund date and time.');
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
              refundedAt: new Date(date).toISOString(),
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
              <p className="text-sm text-destructive" title={summary.error}>
                {describeRefundWorkerError(summary.error)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Attempts in current cycle: {summary.attempts}. Retries requested:{' '}
              {summary.retryRequests}.
            </p>
            {summary.status === 'requires_review' && (
              <p className="text-sm">
                Verify the existing refund in Paystack before taking further
                action.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {summary.canManageRefunds === false ? (
                <p className="text-sm text-muted-foreground">
                  You need refund permission to retry or record refunds.
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
                    // fixed label visible, raw text in the title.
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
                          <p title={eventError}>
                            {describeRefundWorkerError(eventError)}
                          </p>
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
                      {money(item.amount)} · {item.status} · {item.method}
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
