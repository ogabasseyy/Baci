'use client';
import { CheckCircle2, Smartphone } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { OTP_CODE_TTL_SECONDS } from '@/components/ui/otp-verification/use-otp-expiry';
import { useOtpSuccessTransition } from '@/components/ui/otp-verification/use-otp-success-transition';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import { OxygenOtpField } from './OxygenOtpField';
import type { SubmitOxygenForm } from './OxygenVerificationForms';
import { readPhoneOtpSend, rememberPhoneOtpSend } from './phone-otp-window';

export function OxygenPhoneVerification({
  busy,
  workflowId,
  submit,
  verified = false,
  errorMessage,
  clearError,
}: {
  busy: boolean;
  workflowId?: string;
  submit: SubmitOxygenForm;
  verified?: boolean;
  errorMessage?: string;
  clearError?: () => void;
}) {
  const formId = useId();
  const [code, setCode] = useState('');
  const [sentAt, setSentAt] = useState(() => readPhoneOtpSend(workflowId));
  const [pending, setPending] = useState<'verify' | 'resend' | null>(null);
  const [error, setError] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const success = useOtpSuccessTransition();
  const locked = useRef(false);
  const disabled = busy || pending !== null;
  async function run(action: 'verify' | 'resend', completedCode = code) {
    if (busy || verified || success.verified || locked.current) return false;
    if (
      action === 'verify' &&
      sentAt !== undefined &&
      Date.now() >= sentAt + OTP_CODE_TTL_SECONDS * 1000
    )
      return false;
    if (action === 'verify' && !/^[0-9]{6}$/.test(completedCode)) {
      setError('Enter the 6-digit verification code from your phone.');
      return false;
    }
    const requestedAt = Date.now();
    locked.current = true;
    setPending(action);
    setError('');
    setCodeSent(false);
    const otp = completedCode;
    try {
      const acknowledged =
        action === 'verify'
          ? await submit(
              { action: 'validate_customer', otp },
              undefined,
              async () => {
                setPending(null);
                await success.showSuccess();
              }
            )
          : await submit({ action: 'resend_customer_otp' });
      if (action === 'resend' && acknowledged === true) {
        setCodeSent(true);
        setCode('');
        if (workflowId) rememberPhoneOtpSend(workflowId, requestedAt);
        setSentAt(requestedAt);
      }
      return acknowledged === true;
    } catch {
      setError(
        'We could not confirm this step. Check your application status before trying again.'
      );
      return false;
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
        verified={verified || success.verified}
        error={error || errorMessage}
        sentAt={sentAt}
        resendAfterExpiry
        onResend={verified ? undefined : () => run('resend')}
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
        </form>
      )}
    </div>
  );
}
