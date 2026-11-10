'use client';

// Client component: owns the refund-choice radio state and click handlers.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatDisplayCurrency } from '@/lib/format-display-currency';

export type CancelRefundChoice = 'automatic' | 'manual';

const isCancelRefundChoice = (value: string): value is CancelRefundChoice =>
  value === 'automatic' || value === 'manual';

/**
 * Mount with a fresh `key` each time it opens so the choice starts from the
 * safe default instead of the previous order's selection.
 */
export function CancelOrderDialog({
  automaticSupported = true,
  canCancelOnly = true,
  currency,
  inFlightAmount = 0,
  isOpen,
  onClose,
  onConfirm,
  refundAmount,
}: {
  /** False when an outstanding leg cannot be refunded by the worker. */
  automaticSupported?: boolean;
  /** Owner or orders.refund: the cancel-only path skips the auto refund. */
  canCancelOnly?: boolean;
  currency: string | null;
  /** Part of the payment whose provider refund is already in progress. */
  inFlightAmount?: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (refund: CancelRefundChoice) => Promise<void> | void;
  refundAmount: number;
}) {
  // The automatic option is always offered: when the worker cannot refund a
  // leg itself it sends the refund to owner review, which is safe for anyone
  // with edit access. It is also the default, so an inattentive click never
  // lands on a self-refund; cancel-only is an explicit opt-in.
  const refundGoesToReview = !automaticSupported;
  const [choice, setChoice] = useState<CancelRefundChoice>('automatic');
  const [busy, setBusy] = useState(false);
  // Permissions can resolve after the dialog opened: derive the choice that
  // is actually available instead of trusting stale state.
  const effectiveChoice: CancelRefundChoice =
    choice === 'manual' && !canCancelOnly ? 'automatic' : choice;

  const amount = formatDisplayCurrency(refundAmount, currency || 'NGN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Exactly one explanation per state: the selected cancel-only path, else
  // the review path (worded for whether cancel-only is available), else none.
  // The in-flight notice below is a separate warning about already-moving
  // money, not an alternative explanation.
  let explanation: string | null = null;
  if (effectiveChoice === 'manual' && canCancelOnly) {
    explanation = `No refund will be sent automatically for ${
      inFlightAmount > 0 ? `the remaining ${amount}` : 'this order'
    }. The order will show as refund pending until you record that refund from its Refund card.`;
  } else if (refundGoesToReview && canCancelOnly) {
    explanation =
      'Baci cannot refund all of this payment automatically (it was not paid through Paystack, or an earlier refund covered only part of it). Send the refund to the store owner for review, or cancel only, refund the customer yourself and record it from the Refund card.';
  } else if (refundGoesToReview) {
    explanation =
      'Baci cannot refund all of this payment automatically (it was not paid through Paystack, or an earlier refund covered only part of it). The order will be cancelled and the refund sent to the store owner for review.';
  }

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(effectiveChoice);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
          <DialogDescription>
            This order has been paid. Cancelling records your account as the
            actor and restores tracked inventory. Choose how the customer is
            refunded.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={effectiveChoice}
          onValueChange={(value) => {
            if (isCancelRefundChoice(value)) setChoice(value);
          }}
          aria-label="Refund option"
        >
          <div className="flex items-start gap-3">
            <RadioGroupItem
              value="automatic"
              id="cancel-refund-automatic"
              className="mt-1"
            />
            <Label htmlFor="cancel-refund-automatic" className="leading-snug">
              {refundGoesToReview
                ? `Cancel and send the ${amount} refund to review`
                : `Cancel and refund ${amount} to the customer's original payment method`}
            </Label>
          </div>
          {canCancelOnly && (
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="manual"
                id="cancel-refund-manual"
                className="mt-1"
              />
              <Label htmlFor="cancel-refund-manual" className="leading-snug">
                {inFlightAmount > 0
                  ? `Cancel only — I'll refund the remaining ${amount} another way (cash, transfer, store credit)`
                  : "Cancel only — I'll refund them another way (cash, transfer, store credit)"}
              </Label>
            </div>
          )}
        </RadioGroup>
        {explanation && (
          <p className="text-sm text-muted-foreground">{explanation}</p>
        )}
        {inFlightAmount > 0 && (
          <p className="text-sm text-muted-foreground">
            A refund of{' '}
            {formatDisplayCurrency(inFlightAmount, currency || 'NGN', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            is already in progress with the provider. Do not refund that part
            yourself; wait for it to finish.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Keep order
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            Cancel order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
