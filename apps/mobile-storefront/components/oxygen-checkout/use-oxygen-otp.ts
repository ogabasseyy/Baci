import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { OxygenClientError } from '@/services/oxygen/errors';
import { otpRemainingSeconds } from './oxygen-form-utils';
export interface OxygenOtpProps {
  scopeKey: string;
  value: string;
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
  pending: boolean;
  confirmed: boolean;
  sentAt?: string | null;
  expiresAt?: string | null;
  onResend?: () => Promise<void>;
  error?: string | null;
  label?: string;
}
/** Timing is supplied by the server, never invented by resend or mounting. */
export function useOxygenOtp(props: OxygenOtpProps) {
  const [now, setNow] = useState(Date.now);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const submitted = useRef<{
    scope: string;
    window: string;
    code: string;
  } | null>(null);
  const resendLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    function sync() {
      setNow(Date.now());
      if (timer) clearInterval(timer);
      timer =
        !props.confirmed &&
        AppState.currentState !== 'background' &&
        AppState.currentState !== 'inactive'
          ? setInterval(() => setNow(Date.now()), 1000)
          : undefined;
    }
    sync();
    const listener = AppState.addEventListener('change', sync);
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
      listener.remove();
    };
  }, [props.confirmed]);
  const remaining = otpRemainingSeconds(props, now);
  function change(input: string) {
    const p = latest.current;
    if (p.pending || p.confirmed) return;
    const code = input.replace(/\D/g, '').slice(0, 6);
    p.onChange(code);
    if (code.length !== 6) {
      submitted.current = null;
      return;
    }
    if (otpRemainingSeconds(p, Date.now()) <= 0) return;
    const window = p.expiresAt ?? p.sentAt ?? '';
    const previous = submitted.current;
    if (
      previous?.scope === p.scopeKey &&
      previous.window === window &&
      previous.code === code
    )
      return;
    submitted.current = { scope: p.scopeKey, window, code };
    p.onComplete(code);
  }
  async function resend() {
    const p = latest.current;
    if (
      resendLock.current ||
      p.pending ||
      p.confirmed ||
      otpRemainingSeconds(p, Date.now()) > 0 ||
      !p.onResend
    )
      return;
    const scope = p.scopeKey;
    resendLock.current = true;
    setResending(true);
    setResendError(null);
    try {
      await p.onResend();
      if (alive.current && latest.current.scopeKey === scope) {
        submitted.current = null;
        p.onChange('');
      }
    } catch (error) {
      if (alive.current && latest.current.scopeKey === scope)
        setResendError(
          error instanceof OxygenClientError && error.code === 'auth'
            ? 'Your sign-in expired. Sign in again to request a new code.'
            : 'Could not send another code. Try again.'
        );
    } finally {
      resendLock.current = false;
      if (alive.current && latest.current.scopeKey === scope)
        setResending(false);
    }
  }
  return {
    value: props.value,
    change,
    resend,
    remaining,
    resending,
    resendError,
    success: props.confirmed,
  };
}
