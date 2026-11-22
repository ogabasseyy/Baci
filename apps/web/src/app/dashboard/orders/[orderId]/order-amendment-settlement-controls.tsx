'use client';

import { useState } from 'react';
import type { z } from 'zod';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { workspaceSchema } from '@/schemas/order-amendment';

export function OrderAmendmentSettlementControls({
  workspace,
  currency,
  cancelled,
  disabled,
  submit,
}: {
  workspace: z.infer<typeof workspaceSchema>;
  currency: string;
  cancelled: boolean;
  disabled: boolean;
  submit: (action: Record<string, string>) => Promise<void>;
}) {
  const [evidenceId, setEvidenceId] = useState('');
  const [outgoingId, setOutgoingId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const status = workspace.customer;
  if (!workspace.canEdit || !status) return null;
  const latestRefund = workspace.refunds[0];
  const money = (minor: number) => formatDisplayCurrency(minor / 100, currency);
  const latestClaim = workspace.events.findLast(
    (event) =>
      event.type === 'offline_disbursement_claimed' &&
      typeof event.details.claimId === 'string' &&
      !workspace.events.some(
        (verified) =>
          verified.type === 'offline_disbursement_verified' &&
          verified.details.claimId === event.details.claimId
      )
  );
  const claimId =
    typeof latestClaim?.details.claimId === 'string'
      ? latestClaim.details.claimId
      : null;

  return (
    <>
      <AlertDialog
        open={confirmCancellation}
        onOpenChange={setConfirmCancellation}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this order for recovery?</AlertDialogTitle>
            <AlertDialogDescription>
              This cancels fulfillment and starts repayment of the funds
              allocated to the order.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep order</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled}
              onClick={() =>
                submit({ action: 'cancel_for_recovery', reason: reason.trim() })
              }
            >
              Confirm cancellation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <fieldset disabled={disabled} className="space-y-3">
        {(status.state === 'awaiting_payment' ||
          workspace.bankEvidence.some((entry) => !entry.status)) && (
          <div className="grid gap-1.5 sm:max-w-lg">
            <Label htmlFor="top-up-evidence">Verified transfer</Label>
            <select
              id="top-up-evidence"
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={evidenceId}
              onChange={(event) => setEvidenceId(event.target.value)}
            >
              <option value="">Select a bank statement entry</option>
              {workspace.bankEvidence
                .filter((entry) => !entry.status)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {money(entry.amountMinor)} ·{' '}
                    {new Date(entry.occurredAt).toLocaleDateString()}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              type="button"
              variant="outline"
              className="justify-self-start"
              disabled={!evidenceId}
              onClick={() => submit({ action: 'record_top_up', evidenceId })}
            >
              Record verified transfer
            </Button>
          </div>
        )}
        {workspace.canRefund && (
          <>
            {latestRefund && (
              <div className="flex flex-wrap gap-2">
                {[
                  'pending',
                  'processing',
                  'uncertain',
                  'needs_attention',
                ].includes(latestRefund.state) && (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      submit({
                        action: 'refresh_refund_status',
                        operationId: latestRefund.id,
                      })
                    }
                  >
                    {latestRefund.preflightReview
                      ? 'Recheck refund history'
                      : 'Refresh refund status'}
                  </Button>
                )}
                {latestRefund.state === 'failed' && (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      submit({
                        action: 'retry_failed_refund',
                        operationId: latestRefund.id,
                      })
                    }
                  >
                    Retry verified failed refund
                  </Button>
                )}
                {latestRefund.state === 'processed' &&
                  status.holdFulfillment && (
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() =>
                        submit({
                          action: 'retry_merchant_adjustment',
                          operationId: latestRefund.id,
                        })
                      }
                    >
                      Retry approved adjustment
                    </Button>
                  )}
              </div>
            )}
            {status.holdFulfillment && (
              <div className="grid gap-1.5">
                <Label htmlFor="amendment-recovery-reason">
                  Recovery reason
                </Label>
                <Input
                  id="amendment-recovery-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!reason.trim()}
                    onClick={() =>
                      submit({
                        action: 'reverse',
                        reason: reason.trim(),
                      })
                    }
                  >
                    Reverse change
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={!reason.trim()}
                    onClick={() => setConfirmCancellation(true)}
                  >
                    Cancel order for recovery
                  </Button>
                </div>
              </div>
            )}
            {!claimId &&
              workspace.bankEvidence.map((entry) => {
                const sourceId =
                  entry.status === 'unapplied'
                    ? entry.id
                    : cancelled && entry.status === 'top_up'
                      ? entry.transactionId
                      : null;
                if (!sourceId) return null;
                return (
                  <Button
                    key={entry.id}
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() =>
                      submit({
                        action: 'claim_offline_disbursement',
                        sourceId,
                        sourceKind:
                          entry.status === 'unapplied'
                            ? 'unapplied'
                            : 'cancellation_leg',
                      })
                    }
                  >
                    Prepare bank repayment of {money(entry.amountMinor)}
                  </Button>
                );
              })}
            {claimId && (
              <div className="grid gap-1.5">
                <Label htmlFor="outgoing-evidence-id">
                  Verified outgoing bank evidence ID
                </Label>
                <Input
                  id="outgoing-evidence-id"
                  value={outgoingId}
                  maxLength={36}
                  onChange={(event) => setOutgoingId(event.target.value)}
                />
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  className="justify-self-start"
                  disabled={!outgoingId.trim()}
                  onClick={() =>
                    submit({
                      action: 'record_offline_refund',
                      claimId,
                      evidenceId: outgoingId.trim(),
                    })
                  }
                >
                  Verify bank repayment
                </Button>
              </div>
            )}
          </>
        )}
      </fieldset>
    </>
  );
}
