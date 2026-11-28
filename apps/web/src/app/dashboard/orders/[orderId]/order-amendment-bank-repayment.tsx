'use client';

import {
  findLatestOpenDisbursementClaim,
  paidOrderEvidenceIdSchema,
} from '@baci/shared';
import { useState } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { workspaceSchema } from '@/schemas/order-amendment';

export function OrderAmendmentBankRepayment({
  workspace,
  currency,
  cancelled,
  submit,
}: {
  workspace: z.infer<typeof workspaceSchema>;
  currency: string;
  cancelled: boolean;
  submit: (action: Record<string, string>) => Promise<void>;
}) {
  const [outgoingId, setOutgoingId] = useState('');
  const money = (minor: number) => formatDisplayCurrency(minor / 100, currency);
  const evidenceIdIsValid = paidOrderEvidenceIdSchema.safeParse(
    outgoingId.trim()
  ).success;
  const latestClaim = findLatestOpenDisbursementClaim(workspace.events);
  const claimId =
    typeof latestClaim?.details.claimId === 'string'
      ? latestClaim.details.claimId
      : null;

  return (
    <>
      {!claimId &&
        workspace.bankEvidence.map((entry) => {
          if (workspace.isVerifiedFunding && entry.method !== 'bank_transfer')
            return null;
          const sourceId =
            entry.status === 'unapplied' ||
            (workspace.isVerifiedFunding && entry.status === null)
              ? entry.id
              : entry.status === 'top_up' &&
                  !workspace.isVerifiedFunding &&
                  entry.transactionId !== null &&
                  cancelled
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
                    entry.status !== 'top_up'
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
          <p className="text-sm text-muted-foreground">
            Enter a valid evidence UUID from the verified bank transfer.
          </p>
          <Button
            size="sm"
            type="button"
            variant="outline"
            className="justify-self-start"
            disabled={!outgoingId.trim() || !evidenceIdIsValid}
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
  );
}
