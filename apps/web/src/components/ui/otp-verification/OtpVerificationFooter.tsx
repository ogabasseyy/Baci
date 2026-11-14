import type { useOtpExpiry } from './use-otp-expiry';
import type { useOtpResendCooldown } from './use-otp-resend-cooldown';

export function OtpVerificationFooter({
  sentAt,
  onResend,
  resendAfterExpiry,
  expiry,
  expiryAdvisory,
  verified,
  disabled,
  pending,
  resending,
  coolingDown,
  cooldown,
  resend,
}: {
  sentAt?: number;
  onResend?: () => Promise<boolean>;
  resendAfterExpiry: boolean;
  expiry: ReturnType<typeof useOtpExpiry>;
  expiryAdvisory: boolean;
  verified: boolean;
  disabled: boolean;
  pending: boolean;
  resending: boolean;
  coolingDown: boolean;
  cooldown: ReturnType<typeof useOtpResendCooldown>;
  resend: () => Promise<void>;
}) {
  if (sentAt === undefined && !onResend) return null;
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-xs text-[var(--store-foreground,#111827)]">
      {(!resendAfterExpiry || (sentAt !== undefined && !expiry.expired)) && (
        <span
          role="timer"
          aria-live="off"
          aria-label="Code expiry"
          className="tabular-nums"
        >
          {verified
            ? ''
            : expiry.expired
              ? expiryAdvisory
                ? 'Code may have expired'
                : 'Code expired'
              : expiry.remainingSeconds === null
                ? sentAt === undefined
                  ? ''
                  : 'Checking code expiry…'
                : `${expiryAdvisory ? 'Estimated time remaining' : 'Code expires in'} ${Math.floor(expiry.remainingSeconds / 60)}:${String(expiry.remainingSeconds % 60).padStart(2, '0')}`}
        </span>
      )}
      {onResend &&
        (!resendAfterExpiry || sentAt === undefined || expiry.expired) && (
          <button
            type="button"
            className="min-h-11 font-semibold underline disabled:opacity-50"
            disabled={
              disabled || pending || verified || resending || coolingDown
            }
            aria-busy={resending}
            onClick={() => void resend()}
          >
            {resending
              ? 'Sending code…'
              : coolingDown
                ? `Resend code in ${cooldown.remainingSeconds}s`
                : 'Resend code'}
          </button>
        )}
    </div>
  );
}
