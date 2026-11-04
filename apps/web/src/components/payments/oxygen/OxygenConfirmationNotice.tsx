'use client';
import { Check, Clock3 } from 'lucide-react';
import { OxygenLoadingButton } from './OxygenLoadingButton';

/** An uncertain provider response is a saved waiting state, never a retry prompt. */
export function OxygenConfirmationNotice({
  booking,
  queuedApprovalCode = false,
  approvalCodeError = false,
  queuedBooking = false,
  bookingTerms,
  bookingError = false,
  identityCheck = false,
  queuedIdentityCheck = false,
  queuedSelfieCheck = false,
  selfieError = false,
  identityError = false,
  eligibilityCheck = false,
  busy,
  refresh,
}: {
  booking: boolean;
  queuedApprovalCode?: boolean;
  approvalCodeError?: boolean;
  queuedBooking?: boolean;
  bookingTerms?: { equityPercentage: number; tenure: number };
  bookingError?: boolean;
  identityCheck?: boolean;
  queuedIdentityCheck?: boolean;
  queuedSelfieCheck?: boolean;
  selfieError?: boolean;
  identityError?: boolean;
  eligibilityCheck?: boolean;
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
          {queuedSelfieCheck || queuedIdentityCheck
            ? 'Identity verification'
            : identityCheck
              ? 'Identity verification paused'
              : eligibilityCheck
                ? 'Payment options check paused'
                : 'Taking a little longer'}
        </p>
        <h3 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
          {queuedApprovalCode
            ? 'Your approval code request is ready to continue'
            : queuedBooking
              ? 'Your payment plan is ready to continue'
              : queuedSelfieCheck
                ? 'Your selfie verification is ready to continue'
                : queuedIdentityCheck
                  ? 'Your NIN check is ready to continue'
                  : booking
                    ? 'Your payment plan is being confirmed'
                    : identityCheck
                      ? 'Your NIN verification needs confirmation'
                      : eligibilityCheck
                        ? 'Your payment options need confirmation'
                        : 'Your application is being checked'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-600">
          {queuedApprovalCode
            ? 'Continue your saved request to send an approval code. If it has already started, we’ll check its status.'
            : queuedBooking && bookingTerms
              ? `Continue your saved plan with ${bookingTerms.equityPercentage}% down over ${bookingTerms.tenure} months. If it has already started, we’ll check its status.`
              : queuedSelfieCheck
                ? 'Continue preparing your saved selfie verification. If it has already started, we’ll check its status.'
                : queuedIdentityCheck
                  ? 'Continue your saved NIN check. If it has already started, we’ll check its status.'
                  : identityCheck
                    ? 'Your code was accepted, but we couldn’t confirm the result of Oxygen’s NIN check. Your details are saved. Please don’t submit them again.'
                    : eligibilityCheck
                      ? 'We couldn’t confirm the result with Oxygen. Your application is saved. Checking for an update only reads your saved status; it does not repeat the check. Please contact the store for help.'
                      : 'We’re waiting for confirmation from Oxygen. You don’t need to submit this step again.'}
        </p>
      </div>
      {approvalCodeError && (
        <p role="alert" className="text-sm text-red-700">
          We couldn’t continue your code request. Your progress is saved; please
          try again.
        </p>
      )}
      {bookingError && (
        <p role="alert" className="text-sm text-red-700">
          We couldn’t continue your payment plan. Your progress is saved; please
          try again.
        </p>
      )}
      {selfieError && (
        <p role="alert" className="text-sm text-red-700">
          We couldn’t continue your selfie verification. Your progress is saved;
          please try again.
        </p>
      )}
      {identityError && (
        <p role="alert" className="text-sm text-red-700">
          We couldn’t continue your NIN check. Your progress is saved; please
          try again.
        </p>
      )}
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
          {queuedApprovalCode
            ? 'Continue sending approval code'
            : queuedBooking
              ? 'Continue payment plan'
              : queuedSelfieCheck
                ? 'Continue selfie verification'
                : queuedIdentityCheck
                  ? 'Continue NIN check'
                  : 'Check for an update'}
        </OxygenLoadingButton>
        <p className="text-xs leading-relaxed text-gray-500">
          You can close this window and return to your application later.
        </p>
      </div>
    </div>
  );
}
