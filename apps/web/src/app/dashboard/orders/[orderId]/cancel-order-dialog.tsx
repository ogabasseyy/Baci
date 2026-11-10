'use client';

import { useEffect, useState } from 'react';
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

export function CancelOrderDialog({
  currency,
  isOpen,
  onClose,
  onConfirm,
  refundAmount,
}: {
  currency: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (refund: CancelRefundChoice) => Promise<void> | void;
  refundAmount: number;
}) {
  const [choice, setChoice] = useState<CancelRefundChoice>('automatic');
  const [busy, setBusy] = useState(false);

  // The dialog stays mounted between orders; every open starts from the safe
  // automatic default instead of the previous order's choice.
  useEffect(() => {
    if (isOpen) setChoice('automatic');
  }, [isOpen]);
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
          <div className="flex items-start gap-3">
            <RadioGroupItem
              value="automatic"
              id="cancel-refund-automatic"
              className="mt-1"
            />
            <Label htmlFor="cancel-refund-automatic" className="leading-snug">
              Cancel and refund {amount} to the customer&apos;s original payment
              method
            </Label>
          </div>
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
        </RadioGroup>
        {choice === 'manual' && (
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
