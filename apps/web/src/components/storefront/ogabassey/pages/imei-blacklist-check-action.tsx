// The result action subscribes to live capabilities and handles a customer click.
'use client';

import { getDisplayTier } from './imei-checker-tiers';
import { useImeiRuntimeAvailability } from './use-imei-runtime-availability';

export function ImeiBlacklistCheckAction({
  isChecking,
  onCheck,
}: {
  isChecking: boolean;
  onCheck: () => void;
}) {
  // Mounted only for a phone report. Picker changes must not determine the
  // report's capabilities, and this request must not run on the initial form.
  const availability = useImeiRuntimeAvailability('smartphone');
  if (
    availability.loading ||
    availability.failed ||
    !availability.availableTierKeys?.includes('blacklist')
  )
    return null;

  return (
    <button
      className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--store-primary)] px-5 py-3 text-sm font-bold text-[var(--store-primary-text,#ffffff)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isChecking}
      onClick={onCheck}
      type="button"
    >
      {isChecking
        ? 'Checking blacklist…'
        : `Check blacklist status · ${getDisplayTier('blacklist').priceDisplay}`}
    </button>
  );
}
