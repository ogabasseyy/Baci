'use client';

import { useId, useState } from 'react';
import { OtpVerificationField } from '@/components/ui/otp-verification';
import {
  CustomerAuthProvider,
  useCustomerAuth,
  useOptionalCustomerAuth,
} from '@/contexts/customer-auth-context';

interface Props {
  merchantSlug: string;
  onSuccess: () => void;
}

/** Reuse customer OTP authentication, including its merchant-scoped session. */
export function CheckoutCodeSignin(props: Props) {
  const existing = useOptionalCustomerAuth();
  return existing ? (
    <CodeForm onSuccess={props.onSuccess} />
  ) : (
    <CustomerAuthProvider merchantSlug={props.merchantSlug}>
      <CodeForm onSuccess={props.onSuccess} />
    </CustomerAuthProvider>
  );
}

function CodeForm({ onSuccess }: Pick<Props, 'onSuccess'>) {
  const inputId = useId();
  const { sendOtp, verifyOtp } = useCustomerAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = sent ? await verifyOtp(code) : await sendOtp(email.trim());
      if (!result.success)
        setError(result.error || 'Unable to sign in. Please try again.');
      else if (sent) onSuccess();
      else {
        setSent(true);
        setSentAt(Date.now());
      }
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 text-store-background-text"
      aria-label="Sign in with email code"
    >
      <p className="text-sm text-store-background-text/70">
        {sent
          ? `Enter the code sent to ${email}.`
          : 'Sign in securely with a code sent to your email. No password needed.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-store-primary">
          {error}
        </p>
      )}
      {sent ? (
        <OtpVerificationField
          id={inputId}
          label="Verification code"
          value={code}
          onChange={setCode}
          pending={busy}
          hidePendingMessage
          sentAt={sentAt}
          expiryAdvisory
          resendCooldownSeconds={60}
          onResend={async () => {
            const result = await sendOtp(email.trim());
            if (!result.success) return false;
            setCode('');
            setError('');
            setSentAt(Date.now());
            return true;
          }}
        />
      ) : (
        <label htmlFor={inputId} className="grid gap-2 text-sm font-medium">
          Email address
          <input
            id={inputId}
            aria-label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-store-border bg-store-background p-3 text-store-background-text"
          />
        </label>
      )}
      <button
        type="submit"
        disabled={busy || (sent && code.length !== 6)}
        className="w-full rounded-xl bg-store-primary p-3 font-bold text-store-primary-text disabled:opacity-60"
      >
        {busy
          ? sent
            ? 'Verifying code…'
            : 'Sending code…'
          : sent
            ? 'Verify & continue checkout'
            : 'Send sign-in code'}
      </button>
      {sent && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSent(false);
            setCode('');
            setError('');
          }}
          className="text-sm underline"
        >
          Use a different email
        </button>
      )}
    </form>
  );
}
