'use client';

import { useState } from 'react';

/** Cancellation is always initiated explicitly by the customer. */
export function OxygenUnavailablePlanRecovery({
  busy,
  cancel,
  offersMissing = false,
}: {
  busy: boolean;
  cancel: () => Promise<boolean>;
  offersMissing?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-2 text-sm" role="status">
      <p>
        {offersMissing
          ? 'We could not check this plan. You can cancel it to choose another.'
          : 'This plan is no longer available. Cancel it to choose a new one.'}
      </p>
      {!confirming ? (
        <button
          type="button"
          className="min-h-11 text-store-primary underline"
          disabled={busy}
          onClick={() => setConfirming(true)}
        >
          Choose another plan
        </button>
      ) : (
        <>
          <p>We’ll check your payment status before cancelling this plan.</p>
          <button
            type="button"
            className="min-h-11 text-store-primary underline"
            disabled={busy}
            onClick={() => void cancel()}
          >
            Cancel plan and continue
          </button>
          <button
            type="button"
            className="min-h-11 underline"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Keep this plan
          </button>
        </>
      )}
    </div>
  );
}
