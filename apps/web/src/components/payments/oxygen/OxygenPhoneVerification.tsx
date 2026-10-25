'use client';
import { CheckCircle2, Loader2, Smartphone } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import { OxygenOtpField } from './OxygenOtpField';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

export function OxygenPhoneVerification({
  busy,
  submit,
  verified = false,
  errorMessage,
  clearError,
}: {
  busy: boolean;
  submit: SubmitOxygenForm;
  verified?: boolean;
  errorMessage?: string;
  clearError?: () => void;
}) {
  const formId = useId();
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<'verify' | 'resend' | null>(null);
  const [error, setError] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const locked = useRef(false);
  const disabled = busy || pending !== null;
  async function run(action: 'verify' | 'resend', completedCode = code) {
    if (busy || verified || locked.current) return;
    if (action === 'verify' && !/^[0-9]{6}$/.test(completedCode)) {
      setError('Enter the 6-digit verification code from your phone.');
      return;
    }
    locked.current = true;
    setPending(action);
    setError('');
    setCodeSent(false);
    const otp = completedCode;
    try {
      const acknowledged = await submit(
        action === 'verify'
          ? { action: 'validate_customer', otp }
          : { action: 'resend_customer_otp' }
      );
      if (action === 'resend' && acknowledged === true) setCodeSent(true);
    } catch {
      setError(
        'We could not confirm this step. Check your application status before trying again.'
      );
    } finally {
      if (action === 'verify') setCode('');
      locked.current = false;
      setPending(null);
    }
  }
  return (
    <div className="mx-auto grid w-full max-w-md gap-6 py-2">
      <div className="grid justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-store-primary/5 text-store-primary">
          {verified ? (
            <CheckCircle2
              aria-hidden="true"
              className="size-6 text-emerald-700"
            />
          ) : (
            <Smartphone aria-hidden="true" className="size-6" />
          )}
        </span>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-gray-900">
            {verified ? 'Phone verified' : 'Verify your phone'}
          </h3>
          <p className="text-sm leading-relaxed text-gray-500">
            {verified
              ? 'Your phone number has been confirmed by Oxygen.'
              : 'Enter the 6-digit code sent to your phone to continue.'}
          </p>
        </div>
      </div>
      <OxygenOtpField
        form={formId}
        value={code}
        onChange={(value) => {
          setCode(value);
          setError('');
          clearError?.();
        }}
        onComplete={(value) => void run('verify', value)}
        disabled={disabled}
        pending={pending === 'verify'}
        verified={verified}
        error={error || errorMessage}
      />
      {!verified && (
        <form
          id={formId}
          aria-label="Verify phone"
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void run('verify');
          }}
        >
          {codeSent && (
            <p role="status" className="text-center text-sm text-emerald-700">
              A new code has been sent. Check your phone.
            </p>
          )}
          <OxygenLoadingButton
            type="submit"
            className="w-full"
            loading={pending === 'verify'}
            pendingLabel="Verifying…"
            disabled={disabled || code.length !== 6}
          >
            Verify phone
          </OxygenLoadingButton>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-gray-500">
            <span>Didn’t receive a code?</span>
            <button
              type="button"
              disabled={disabled}
              aria-busy={pending === 'resend'}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 font-semibold text-store-primary outline-offset-4 disabled:opacity-50"
              onClick={() => void run('resend')}
            >
              {pending === 'resend' && (
                <Loader2
                  aria-hidden="true"
                  className="size-3.5 motion-safe:animate-spin"
                />
              )}
              {pending === 'resend' ? 'Sending…' : 'Resend code'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
