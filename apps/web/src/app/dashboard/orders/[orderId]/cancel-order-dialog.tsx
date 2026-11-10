'use client';

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
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (refund: CancelRefundChoice) => Promise<void> | void;
  refundAmount: number;
}) {
  // Staff without refund permission cannot choose cancel-only, but the
  // server still lets them cancel in automatic mode: when the worker cannot
  // refund a leg itself, that sends the refund to owner review.
  const refundGoesToReview = !automaticSupported && !canCancelOnly;
  const showAutomatic = automaticSupported || refundGoesToReview;
  const [choice, setChoice] = useState<CancelRefundChoice>(
    automaticSupported || !canCancelOnly ? 'automatic' : 'manual'
  );
  const [busy, setBusy] = useState(false);

  const amount = formatDisplayCurrency(refundAmount, currency || 'NGN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm(choice);
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
          value={choice}
          onValueChange={(value) => {
            if (isCancelRefundChoice(value)) setChoice(value);
          }}
          aria-label="Refund option"
        >
          {showAutomatic && (
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
          )}
          {canCancelOnly && (
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="manual"
                id="cancel-refund-manual"
                className="mt-1"
              />
              <Label htmlFor="cancel-refund-manual" className="leading-snug">
                Cancel only — I&apos;ll refund them another way (cash, transfer,
                store credit)
              </Label>
            </div>
          )}
        </RadioGroup>
        {!automaticSupported && canCancelOnly && (
          <p className="text-sm text-muted-foreground">
            Baci cannot refund all of this payment automatically (it was not
            paid through Paystack, or an earlier refund covered only part of
            it). Cancel the order, refund the customer yourself, then record the
            refund from the Refund card.
          </p>
        )}
        {refundGoesToReview && (
          <p className="text-sm text-muted-foreground">
            Baci cannot refund all of this payment automatically (it was not
            paid through Paystack, or an earlier refund covered only part of
            it). The order will be cancelled and the refund sent to the store
            owner for review.
          </p>
        )}
        {choice === 'manual' && canCancelOnly && (
          <p className="text-sm text-muted-foreground">
            No refund will be sent automatically. The order will show as refund
            pending until you record the refund from its Refund card.
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
