'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function OrderRefundManualForm({
  amount,
  busy,
  confirmed,
  currency,
  date,
  method,
  note,
  onAmountChange,
  onConfirmedChange,
  onDateChange,
  onMethodChange,
  onNoteChange,
  onReferenceChange,
  onSubmit,
  reference,
  remaining,
}: {
  amount: string;
  busy: boolean;
  confirmed: boolean;
  currency: string;
  date: string;
  method: string;
  note: string;
  onAmountChange: (value: string) => void;
  onConfirmedChange: (value: boolean) => void;
  onDateChange: (value: string) => void;
  onMethodChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onSubmit: () => void;
  reference: string;
  remaining: number;
}) {
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <p className="text-sm">
        Record money already returned to the customer. This action does not send
        money.
      </p>
      <Label htmlFor="refund-amount">Amount ({currency})</Label>
      <Input
        id="refund-amount"
        type="number"
        min="0.01"
        max={remaining}
        step="0.01"
        required
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
      />
      <Label htmlFor="refund-date">Refund date and time</Label>
      <Input
        id="refund-date"
        type="datetime-local"
        required
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
      />
      <Label htmlFor="refund-method">Method</Label>
      <select
        id="refund-method"
        className="w-full rounded-md border p-2"
        value={method}
        onChange={(e) => onMethodChange(e.target.value)}
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
        onChange={(e) => onReferenceChange(e.target.value)}
      />
      <Label htmlFor="refund-note">Note (optional)</Label>
      <Input
        id="refund-note"
        maxLength={500}
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
      />
      <Label className="flex gap-2">
        <input
          type="checkbox"
          required
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
        />
        I confirm this money has already been refunded.
      </Label>
      <Button type="submit" disabled={busy || !confirmed}>
        {busy ? 'Saving…' : 'Save manual refund'}
      </Button>
    </form>
  );
}
