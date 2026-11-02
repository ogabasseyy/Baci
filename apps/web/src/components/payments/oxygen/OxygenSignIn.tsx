'use client';
import { Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  CustomerAuthProvider,
  useCustomerAuth,
} from '@/contexts/customer-auth-context';
import { OxygenApplicationLoading } from './OxygenApplicationLoading';
import { OxygenLoadingButton } from './OxygenLoadingButton';
import { OxygenOtpField } from './OxygenOtpField';
import { oxygenFieldClass as field } from './oxygen-checkout-styles';

type Props = { merchantSlug?: string; onSignedIn(): void };

/** Use the store's existing passwordless auth, scoped to this recovery panel. */
export function OxygenSignIn({ merchantSlug, onSignedIn }: Props) {
  if (!merchantSlug)
    return (
      <p className="text-sm leading-relaxed text-gray-600">
        Open this application from your store’s checkout to sign in and
        continue.
      </p>
    );
  return (
    <CustomerAuthProvider merchantSlug={merchantSlug}>
      <CustomerSignIn onSignedIn={onSignedIn} />
    </CustomerAuthProvider>
  );
}

function CustomerSignIn({ onSignedIn }: Pick<Props, 'onSignedIn'>) {
  const { isLoading, isAuthenticated, sendOtp, verifyOtp } = useCustomerAuth();
  const [email, setEmail] = useState('');
  const [codeEmail, setCodeEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | 'resend' | null>(null);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const locked = useRef(false);
  const completed = useRef(false);
  function finish() {
    if (completed.current) return;
    completed.current = true;
    onSignedIn();
  }
  useEffect(() => {
    if (isAuthenticated && !completed.current) {
      completed.current = true;
      onSignedIn();
    }
  }, [isAuthenticated, onSignedIn]);

  async function send(resend = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(resend ? 'resend' : 'send');
    setError('');
    setResent(false);
    try {
      const destination = resend ? codeEmail : email.trim();
      const result = await sendOtp(destination);
      if (!result.success) {
        setError(
          result.error || 'We couldn’t send a sign-in code. Please try again.'
        );
        return;
      }
      setCodeEmail(destination);
      setCode('');
      setResent(resend);
    } catch {
      setError('We couldn’t send a sign-in code. Please try again.');
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }
  async function verify(value = code) {
    if (locked.current || !/^[0-9]{6}$/.test(value)) return;
    locked.current = true;
    setBusy('verify');
    setError('');
    try {
      const result = await verifyOtp(value);
      if (result.success) finish();
      else
        setError(
          result.error ||
            'That sign-in code isn’t valid. Try again or request a new code.'
        );
    } catch {
      setError('We couldn’t check that sign-in code. Please try again.');
    } finally {
      setCode('');
      locked.current = false;
      setBusy(null);
    }
  }
  if (isLoading || isAuthenticated) return <OxygenApplicationLoading />;
  return (
    <div className="mx-auto grid w-full max-w-sm gap-5 py-3">
      <div className="grid justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-store-primary/5 text-store-primary">
          <Mail aria-hidden="true" className="size-6" />
        </span>
        <h3 className="text-xl font-bold text-gray-900">
          {codeEmail ? 'Check your email' : 'Sign in to Ogabassey'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-600">
          {codeEmail
            ? `Enter the 6-digit sign-in code sent to ${codeEmail}.`
            : 'Your application is saved. Use an email code to sign back in and continue.'}
        </p>
      </div>
      {!codeEmail ? (
        <form
          aria-label="Sign in to continue"
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="grid gap-1.5 text-xs font-bold text-gray-700">
            Email
            <input
              className={field}
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError('');
              }}
              disabled={busy !== null}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <OxygenLoadingButton
            type="submit"
            loading={busy === 'send'}
            pendingLabel="Sending code…"
            disabled={busy !== null}
          >
            Email me a sign-in code
          </OxygenLoadingButton>
        </form>
      ) : (
        <>
          <OxygenOtpField
            value={code}
            onChange={(value) => {
              setCode(value);
              setError('');
            }}
            onComplete={(value) => void verify(value)}
            disabled={busy !== null}
            pending={busy === 'verify'}
            verified={false}
            error={error}
          />
          {resent && (
            <p role="status" className="text-center text-sm text-emerald-700">
              A new sign-in code has been sent.
            </p>
          )}
          <OxygenLoadingButton
            type="button"
            loading={busy === 'verify'}
            pendingLabel="Signing in…"
            disabled={busy !== null || code.length !== 6}
            onClick={() => void verify()}
          >
            Sign in and continue
          </OxygenLoadingButton>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            <button
              type="button"
              className="min-h-11 font-semibold text-store-primary disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void send(true)}
            >
              {busy === 'resend' ? 'Sending…' : 'Resend sign-in code'}
            </button>
            <button
              type="button"
              className="min-h-11 text-gray-600 underline underline-offset-4 disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => {
                setCodeEmail('');
                setCode('');
                setError('');
              }}
            >
              Use a different email
            </button>
          </div>
        </>
      )}
      <p className="text-center text-xs leading-relaxed text-gray-500">
        This signs you in to Ogabassey. It is separate from Oxygen’s phone
        verification.
      </p>
    </div>
  );
}
