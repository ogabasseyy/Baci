'use client';

import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { workspaceSchema } from '@/schemas/order-amendment';

export function OrderAmendmentVerifiedSettlement({
  workspace,
  disabled,
  reason,
  setReason,
  submit,
}: {
  workspace: z.infer<typeof workspaceSchema>;
  disabled: boolean;
  reason: string;
  setReason: (reason: string) => void;
  submit: (action: Record<string, string>) => Promise<void>;
}) {
  if (!workspace.canRefund) return null;
  const canCancel =
    workspace.canOpenVerifiedCancellation ||
    workspace.verifiedCancellationReady;
  return (
    <fieldset disabled={disabled} className="space-y-3">
      {workspace.verifiedCreditDirectRefund && (
        <Button
          size="sm"
          type="button"
          onClick={() => submit({ action: 'record_verified_lender_refund' })}
        >
          Record verified Credit Direct refund
        </Button>
      )}
      {workspace.verifiedCancellationPending && (
        <p className="text-sm" role="status">
          {workspace.verifiedCancellationReady
            ? 'Refund evidence is complete. The order can be cancelled.'
            : 'Fulfillment is on hold while Finance verifies every refund.'}
        </p>
      )}
      {canCancel && (
        <div className="grid gap-1.5 sm:max-w-lg">
          <Label htmlFor="verified-cancellation-reason">
            Cancellation reason
          </Label>
          <Input
            id="verified-cancellation-reason"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!reason.trim()}
            onClick={() =>
              submit({
                action: workspace.verifiedCancellationReady
                  ? 'cancel_with_verified_refunds'
                  : 'open_verified_cancellation',
                reason: reason.trim(),
              })
            }
          >
            {workspace.verifiedCancellationReady
              ? 'Cancel with verified refunds'
              : 'Put order on hold for cancellation'}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
