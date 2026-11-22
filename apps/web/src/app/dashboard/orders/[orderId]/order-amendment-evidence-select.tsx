'use client';

import type { z } from 'zod';
import { Label } from '@/components/ui/label';
import type { amendmentPreviewResult } from '@/schemas/order-amendment';

export function OrderAmendmentEvidenceSelect({
  entries,
  value,
  onChange,
  money,
}: {
  entries: z.infer<typeof amendmentPreviewResult>['bankEvidence'];
  value: string;
  onChange: (id: string) => void;
  money: (minor: number) => string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="amendment-bank-evidence">Verified top-up</Label>
      <select
        id="amendment-bank-evidence"
        className="h-10 rounded-md border bg-background px-3 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {entries?.length
            ? 'Select the payment'
            : 'No matching payment verified'}
        </option>
        {entries?.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.method === 'cash'
              ? 'Cash'
              : entry.method === 'pos'
                ? 'POS'
                : 'Bank transfer'}{' '}
            · {money(entry.amountMinor)} ·{' '}
            {new Date(entry.occurredAt).toLocaleString()} ·{' '}
            {entry.id.slice(0, 8)}
          </option>
        ))}
      </select>
    </div>
  );
}
