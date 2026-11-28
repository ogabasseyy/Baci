'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { workspaceSchema } from '@/schemas/order-amendment';
import type { OrderDetailsItem } from '../order-items';
import {
  AmendmentRequestError,
  requestAmendment,
} from './order-amendment-client';
import { OrderAmendmentDialog } from './order-amendment-dialog';
import { OrderAmendmentSettlementControls } from './order-amendment-settlement-controls';

type Workspace = z.infer<typeof workspaceSchema>;
type Action = Record<string, string>;
type Props = {
  orderId: string;
  currency: string;
  items: OrderDetailsItem[];
  cancelled: boolean;
  onHoldChange: (hold: boolean) => void;
};

const labels: Record<string, string> = {
  confirmed: 'Items changed',
  refund_queued: 'Refund queued',
  refund_evidence_review: 'Refund history requires review',
  refund_preflight_cleared: 'Refund history review cleared',
  bank_funds_unapplied: 'Transfer awaiting return',
  top_up_recorded: 'Top-up recorded',
  refund_submission_claimed: 'Refund submission claimed',
  refund_status_changed: 'Refund status updated',
  customer_refund_verified: 'Customer refund verified',
  merchant_adjustment_applied: 'Merchant adjustment completed',
  reversed: 'Change reversed',
  cancelled_for_recovery: 'Order cancelled for recovery',
  offline_disbursement_claimed: 'Bank repayment prepared',
  offline_disbursement_verified: 'Bank repayment verified',
};

export function OrderAmendmentPanel({
  orderId,
  currency,
  items,
  cancelled,
  onHoldChange,
}: Props) {
  const path = `/api/orders/${orderId}/amendments`;
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState<{ body: Action; path: string } | null>(
    null
  );
  const money = (minor: number) => formatDisplayCurrency(minor / 100, currency);

  useEffect(() => {
    const controller = new AbortController();
    requestAmendment(path, undefined, controller.signal)
      .then((result) => {
        const state = workspaceSchema.parse(result);
        setWorkspace(state);
        onHoldChange(state.customer?.holdFulfillment ?? false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(
            'Unable to load item-change details. Reload the order to try again.'
          );
        }
      });
    return () => controller.abort();
  }, [path, onHoldChange]);

  async function refresh() {
    const state = workspaceSchema.parse(await requestAmendment(path));
    setWorkspace(state);
    onHoldChange(state.customer?.holdFulfillment ?? false);
    router.refresh();
    return state;
  }

  async function recoverConfirmation(confirmationKey: string) {
    try {
      const current = await refresh();
      if (current.confirmationKey === confirmationKey) return 'confirmed';
      if (current.summary) return 'competing';
    } catch {
      // Keep the exact submission available until its outcome can be read.
    }
    return 'unknown';
  }

  function onConfirmed() {
    setOpen(false);
    void refresh().catch(() =>
      setError(
        'The change was saved. Reload the order to see the latest details.'
      )
    );
  }

  async function submit(action: Action, retrying = false) {
    if (!workspace?.summary) return;
    const target =
      retrying && retry
        ? retry.path
        : `${path}/${workspace.summary.amendmentId}/actions`;
    const body =
      retrying && retry
        ? retry.body
        : { ...action, idempotencyKey: crypto.randomUUID() };
    setPending(true);
    setError('');
    try {
      await requestAmendment(target, body);
      setRetry(null);
    } catch (failure) {
      if (
        failure instanceof AmendmentRequestError &&
        (failure.status ?? 500) < 500
      ) {
        setRetry(null);
        setError(failure.message);
      } else {
        setRetry({ path: target, body });
        setError(
          'The result is unclear. Refresh the order or retry the same request.'
        );
      }
    } finally {
      setPending(false);
    }
    await refresh().catch(() =>
      setError('Unable to refresh the order change.')
    );
  }

  if (!workspace?.canStart && !workspace?.summary) {
    return error ? <p role="alert">{error}</p> : null;
  }

  const status = workspace.customer;
  const latestRefund = workspace.refunds[0];
  const invoice = `/api/orders/${orderId}/invoice`;

  return (
    <>
      {open && (
        <OrderAmendmentDialog
          path={path}
          items={items}
          currency={currency}
          canRefund={workspace.canRefund}
          onClose={() => setOpen(false)}
          onConfirmed={onConfirmed}
          onConflict={() => {
            setOpen(false);
            setError('A different change was confirmed for this order.');
          }}
          resolveConfirmation={recoverConfirmation}
        />
      )}
      {workspace.canStart && (
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Change items
        </Button>
      )}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle>Order change</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm" role="status">
              {status.state === 'awaiting_payment' &&
                `Balance due ${money(status.balanceDueMinor)}.`}
              {status.state === 'awaiting_refund' &&
                (latestRefund?.state === 'processed'
                  ? 'Customer refund processed. Merchant reconciliation pending.'
                  : latestRefund?.preflightReview
                    ? 'Refund on hold while the original payment refund history is checked.'
                    : `Refund owed ${money(status.refundOwedMinor)}.`)}
              {status.state === 'settled' && 'Change settled.'}
              {status.state === 'reversed' && 'Change reversed.'}
              {status.state === 'cancelled_for_recovery' &&
                (workspace.isVerifiedFunding
                  ? 'Order cancelled and refunds verified.'
                  : 'Cancelled for recovery.')}
              {status.holdFulfillment && ' Fulfillment is on hold.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={invoice}>Original invoice</a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`${invoice}?revision=${status.documentId ?? 'current'}`}
                >
                  Revised invoice
                </a>
              </Button>
            </div>
            <OrderAmendmentSettlementControls
              workspace={workspace}
              currency={currency}
              cancelled={cancelled}
              disabled={pending || retry !== null}
              submit={submit}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {retry && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => submit(retry.body, true)}
              >
                Retry same request
              </Button>
            )}
            <details className="border-t pt-3">
              <summary className="cursor-pointer text-sm font-medium">
                Change history
              </summary>
              <ol className="mt-2 grid gap-2">
                {workspace.events.map((event) => (
                  <li key={event.id} className="text-sm">
                    <span>
                      {labels[event.type] ?? event.type.replaceAll('_', ' ')}
                    </span>
                    <time
                      className="ml-2 text-muted-foreground"
                      dateTime={event.createdAt}
                    >
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                    {typeof event.details.reason === 'string' && (
                      <p className="text-muted-foreground">
                        {event.details.reason}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          </CardContent>
        </Card>
      )}
    </>
  );
}
