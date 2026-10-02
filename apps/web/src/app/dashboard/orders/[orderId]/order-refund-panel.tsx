'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orderRefundStatusLabels } from '@/config/order-refund';
import { apiPost } from '@/lib/api-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { RefundSummary } from '@/lib/orders/refund-summary';

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
        const response = await fetch(`/api/orders/${orderId}/refund`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
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

  useEffect(() => {
    if (summary?.status === 'refunded') onRefunded?.();
  }, [summary?.status, onRefunded]);

  async function submit(action: 'retry' | 'manual') {
    if (busy) return;
    if (
      action === 'retry' &&
      !window.confirm(
        'Retry the remaining refund? Fund your Paystack balance first.'
      )
    )
      return;
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
        `/api/orders/${orderId}/refund`,
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
                Verify the existing refund in Paystack before taking further
                action.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {summary.canRetry && (
                <Button disabled={busy} onClick={() => void submit('retry')}>
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
            </div>
            {showForm && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit('manual');
                }}
              >
                <p className="text-sm">
                  Record money already returned to the customer. This action
                  does not send money.
                </p>
                <Label htmlFor="refund-amount">
                  Amount ({summary.currency})
                </Label>
                <Input
                  id="refund-amount"
                  type="number"
                  min="0.01"
                  max={summary.remaining}
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Label htmlFor="refund-date">Refund date and time</Label>
                <Input
                  id="refund-date"
                  type="datetime-local"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <Label htmlFor="refund-method">Method</Label>
                <select
                  id="refund-method"
                  className="w-full rounded-md border p-2"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="paystack">Paystack</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
                <Label htmlFor="refund-reference">Reference</Label>
                <Input
                  id="refund-reference"
                  required
                  maxLength={100}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <Label htmlFor="refund-note">Note (optional)</Label>
                <Input
                  id="refund-note"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Label className="flex gap-2">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  I confirm this money has already been refunded.
                </Label>
                <Button type="submit" disabled={busy || !confirmed}>
                  {busy ? 'Saving…' : 'Save manual refund'}
                </Button>
              </form>
            )}
            {summary.events && summary.events.length > 0 && (
              <details>
                <summary>Refund activity</summary>
                <ul className="space-y-2 text-sm" aria-label="Refund activity">
                  {summary.events.map((event) => (
                    <li key={event.id}>
                      <p>
                        {orderRefundStatusLabels[event.action] ||
                          'Refund activity'}{' '}
                        · {new Date(event.date).toLocaleString()}
                      </p>
                      {(event.details.error || event.details.previousError) && (
                        <p>
                          {event.details.error || event.details.previousError}
                        </p>
                      )}
                    </li>
                  ))}
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
