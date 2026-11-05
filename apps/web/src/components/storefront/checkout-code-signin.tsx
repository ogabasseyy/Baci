'use client';

import { useId, useState } from 'react';
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
      else setSent(true);
    } catch {
      setError('Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-label="Sign in with email code"
    >
      <p className="text-sm text-gray-600">
        {sent
          ? `Enter the code sent to ${email}.`
          : 'Sign in securely with a code sent to your email. No password needed.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-store-primary">
          {error}
        </p>
      )}
      <label htmlFor={inputId} className="grid gap-2 text-sm font-medium">
        {sent ? 'Verification code' : 'Email address'}
        {sent ? (
          <input
            id={inputId}
            aria-label="Verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full rounded-xl border border-gray-200 p-3"
          />
        ) : (
          <input
            id={inputId}
            aria-label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-gray-200 p-3"
          />
        )}
      </label>
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
