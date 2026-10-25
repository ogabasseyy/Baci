'use client';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { Check } from 'lucide-react';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { InputOTP } from '@/components/ui/input-otp';
import styles from './OtpVerificationField.module.css';
import { OTP_CODE_TTL_SECONDS, useOtpExpiry } from './use-otp-expiry';

export interface OtpVerificationFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Opt in to completion handling; verification remains the caller's job. */
  onComplete?: (value: string) => void;
  length?: 4 | 6;
  label?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  pending?: boolean;
  verified?: boolean;
  form?: string;
  error?: string;
  hint?: string;
  pendingMessage?: string;
  successMessage?: string;
  concealDigits?: boolean;
  /** Visual completion only. Never treat animation completion as verification. */
  onStackComplete?: () => void;
  /** Successful send time in epoch milliseconds. No code or token is stored. */
  sentAt?: number;
  ttlSeconds?: number;
  onResend?: () => Promise<boolean>;
}

/** Controlled input with paste, autofill, reduced motion and compositor-friendly motion. */
export function OtpVerificationField({
  value,
  onChange,
  onComplete,
  length = 6,
  label = 'Verification code',
  name = 'otp',
  id: suppliedId,
  disabled = false,
  readOnly = false,
  pending = false,
  verified = false,
  form,
  error,
  hint,
  pendingMessage = 'Checking your code…',
  successMessage = 'Code verified.',
  concealDigits = false,
  onStackComplete,
  sentAt,
  ttlSeconds = OTP_CODE_TTL_SECONDS,
  onResend,
}: OtpVerificationFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wasPending = useRef(pending);
  useEffect(() => {
    const input = inputRef.current;
    if (
      wasPending.current &&
      !pending &&
      !verified &&
      !readOnly &&
      input &&
      !input.disabled
    ) {
      input.focus({ preventScroll: true });
    }
    wasPending.current = pending;
  }, [pending, verified, readOnly]);
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const center = (length - 1) / 2;
  const expiry = useOtpExpiry(sentAt, ttlSeconds, !verified);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState('');
  const resendLock = useRef(false);
  const feedbackError = error || resendError;
  const expiredNow = () =>
    expiry.expired ||
    (expiry.expiresAt !== null && Date.now() >= expiry.expiresAt);
  async function resend() {
    if (!onResend || disabled || pending || verified || resendLock.current)
      return;
    resendLock.current = true;
    setResending(true);
    setResendError('');
    try {
      if (!(await onResend()))
        setResendError(
          'We could not send a new code. Check the saved status before trying again.'
        );
    } catch {
      setResendError(
        'We could not send a new code. Check the saved status before trying again.'
      );
    } finally {
      resendLock.current = false;
      setResending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <label htmlFor={id} className="text-xs font-semibold text-gray-700">
        {label}
      </label>
      <InputOTP
        ref={inputRef}
        id={id}
        aria-invalid={Boolean(feedbackError) || expiry.expired}
        aria-describedby={feedbackError ? `${id}-error` : `${id}-feedback`}
        form={form}
        name={name}
        value={value}
        readOnly={readOnly}
        onChange={(code) => {
          if (
            !expiredNow() &&
            expiry.ready &&
            !pending &&
            !verified &&
            !disabled &&
            !readOnly
          )
            onChange(code);
        }}
        onComplete={(code) => {
          if (
            !expiredNow() &&
            expiry.ready &&
            !pending &&
            !verified &&
            !disabled &&
            !readOnly
          )
            onComplete?.(code);
        }}
        maxLength={length}
        minLength={length}
        required
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        disabled={
          disabled ||
          pending ||
          verified ||
          resending ||
          expiry.expired ||
          !expiry.ready
        }
        pushPasswordManagerStrategy="none"
        containerClassName="w-full has-disabled:opacity-100"
        pasteTransformer={(text) => text.replace(/[\s-]/g, '')}
        render={({ slots }) => (
          <div
            className={styles.slots}
            style={{ '--otp-count': length } as CSSProperties}
            aria-hidden="true"
            data-error={Boolean(feedbackError)}
            data-state={verified ? 'verified' : pending ? 'pending' : 'idle'}
          >
            {slots.map((slot, index) => (
              <div
                key={
                  ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][
                    index
                  ]
                }
                className={styles.slot}
                data-active={slot.isActive}
                data-filled={Boolean(slot.char)}
                onAnimationEnd={(event) => {
                  if (
                    verified &&
                    index === slots.length - 1 &&
                    event.target === event.currentTarget &&
                    event.animationName === styles.stack
                  )
                    onStackComplete?.();
                }}
                style={
                  {
                    '--travel': center - index,
                    '--delay': `${index * 60}ms`,
                    '--stack': `${(index - center) * 1.25}px`,
                    '--tilt': `${(index - center) * 1.2}deg`,
                  } as CSSProperties
                }
              >
                <span>
                  {pending || verified || expiry.expired
                    ? null
                    : concealDigits && slot.char
                      ? '•'
                      : slot.char}
                </span>
                {!pending &&
                  !verified &&
                  !expiry.expired &&
                  slot.hasFakeCaret && <span className={styles.caret} />}
              </div>
            ))}
            <span className={styles.success}>
              <Check className="size-7" />
            </span>
          </div>
        )}
      />
      <div
        id={`${id}-feedback`}
        role="status"
        aria-label={`${label} status`}
        aria-live={feedbackError ? 'off' : 'polite'}
        aria-atomic="true"
        className={
          feedbackError
            ? 'text-sm leading-relaxed text-red-700'
            : 'text-center text-xs text-gray-500'
        }
      >
        {feedbackError ? (
          <span id={`${id}-error`} role="alert">
            {feedbackError}
          </span>
        ) : pending ? (
          pendingMessage
        ) : verified ? (
          successMessage
        ) : expiry.expired ? (
          'This code has expired. Request a new code.'
        ) : (
          hint || `Enter the ${length}-digit code.`
        )}
      </div>
      {(sentAt !== undefined || onResend) && (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span
            role="timer"
            aria-live="off"
            aria-label="Code expiry"
            className="tabular-nums"
          >
            {verified
              ? ''
              : expiry.expired
                ? 'Code expired'
                : expiry.remainingSeconds === null
                  ? sentAt === undefined
                    ? ''
                    : 'Checking code expiry…'
                  : `Code expires in ${Math.floor(expiry.remainingSeconds / 60)}:${String(expiry.remainingSeconds % 60).padStart(2, '0')}`}
          </span>
          {onResend && (
            <button
              type="button"
              className="min-h-11 font-semibold underline disabled:opacity-50"
              disabled={disabled || pending || verified || resending}
              onClick={() => void resend()}
            >
              {resending ? 'Sending…' : 'Resend code'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
