'use client';
import { useId, useState } from 'react';
import { checkoutStyles } from '@/components/storefront/shared/checkout-theme';

export function OxygenPlanReview({
  percentage,
  busy,
  onReplace,
  onAccept,
}: {
  percentage: number;
  busy: boolean;
  onReplace: (value: number) => void;
  onAccept: () => void;
}) {
  const id = useId();
  const [selected, setSelected] = useState(percentage);
  const [accepted, setAccepted] = useState(false);
  const changed = selected !== percentage;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-lg font-semibold">Review your plan</h2>
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-equity`}>
          Down payment
          <select
            id={`${id}-equity`}
            value={selected}
            disabled={busy}
            onChange={(event) => setSelected(Number(event.target.value))}
            className="min-h-11 rounded-lg border border-gray-300 px-3"
          >
            <option value="25">25%</option>
            <option value="30">30%</option>
            <option value="35">35%</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy || !changed}
          onClick={() => onReplace(selected)}
          className={`min-h-11 rounded-lg border px-4 text-sm disabled:opacity-40 ${checkoutStyles.outlineButton}`}
        >
          Update plan
        </button>
      </div>
      <label
        className="mb-4 flex items-center gap-3 text-sm"
        htmlFor={`${id}-accept`}
      >
        <input
          id={`${id}-accept`}
          type="checkbox"
          checked={accepted}
          disabled={busy || changed}
          onChange={(event) => setAccepted(event.target.checked)}
          className="size-5 accent-store-primary"
        />
        I accept this repayment plan
      </label>
      <button
        type="button"
        onClick={onAccept}
        disabled={busy || changed || !accepted}
        className={`min-h-11 rounded-lg px-5 py-3 font-medium disabled:opacity-40 ${checkoutStyles.primaryButton}`}
      >
        Continue to payment
      </button>
    </section>
  );
}
