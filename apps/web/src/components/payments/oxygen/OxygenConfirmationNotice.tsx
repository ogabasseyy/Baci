'use client';
import { Check, Clock3 } from 'lucide-react';
import { OxygenLoadingButton } from './OxygenLoadingButton';

/** An uncertain provider response is a saved waiting state, never a retry prompt. */
export function OxygenConfirmationNotice({
  booking,
  identityCheck = false,
  busy,
  refresh,
}: {
  booking: boolean;
  identityCheck?: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  return (
    <div className="mx-auto grid w-full max-w-md justify-items-center gap-5 py-5 text-center sm:py-8">
      <span className="flex size-14 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-8 ring-amber-50/40">
        <Clock3 aria-hidden="true" className="size-6" />
      </span>
      <div className="space-y-3" role="status">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          {identityCheck
            ? 'Identity verification paused'
            : 'Taking a little longer'}
        </p>
        <h3 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
          {booking
            ? 'Your payment plan is being confirmed'
            : identityCheck
              ? 'Your NIN verification needs confirmation'
              : 'Your application is being checked'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-600">
          {identityCheck
            ? 'Your code was accepted, but we couldn’t confirm the result of Oxygen’s NIN check. Your details are saved. Please don’t submit them again.'
            : 'We’re waiting for confirmation from Oxygen. You don’t need to submit this step again.'}
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <Check aria-hidden="true" className="size-4" /> Your progress is saved
      </div>
      <div className="grid w-full gap-3 border-t border-gray-100 pt-5">
        <OxygenLoadingButton
          type="button"
          loading={busy}
          pendingLabel="Checking for an update…"
          className="w-full"
          onClick={() => void refresh()}
        >
          Check for an update
        </OxygenLoadingButton>
        <p className="text-xs leading-relaxed text-gray-500">
          You can close this window and return to your application later.
        </p>
      </div>
    </div>
  );
}
