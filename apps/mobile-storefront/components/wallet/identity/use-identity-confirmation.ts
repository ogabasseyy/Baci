import { useEffect, useRef, useState } from 'react';
import {
  confirmIdentityCode,
  sendIdentityCode,
} from '@/lib/wallet-identity-confirm-api';
import { useAuthStore } from '@/stores/auth-store';
import { maskEmail } from './mask-email';

export const IDENTITY_CODE_LENGTH = 6;
/** The server also limits sends; this just stops repeat taps. */
const RESEND_COOLDOWN_MS = 30_000;
const FALLBACK_ERROR = 'Something went wrong. Please try again.';
const NO_EMAIL =
  'We could not find an email for this account. Please sign out and sign in again.';
const CODE_SENT = 'We sent you a new code.';

function messageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : FALLBACK_ERROR;
}

/**
 * The "Confirm it's you" step before setting or resetting a wallet PIN: email
 * the signed-in customer a 6-digit code, check it, and refresh the sign-in in
 * place. The code lives only in this state and the request body.
 */
export function useIdentityConfirmation({
  expectedUserId,
  onConfirmed,
}: {
  expectedUserId?: string;
  onConfirmed: () => void;
}) {
  const email = useAuthStore((s) => s.user?.email ?? null);
  const signedInUserId = useAuthStore((s) => s.user?.id ?? null);
  const userId = expectedUserId ?? signedInUserId;
  const [sent, setSent] = useState(false);
  const [code, setCodeValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(true);
  const busyRef = useRef(false);
  const [canResend, setCanResend] = useState(true);
  const resendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The account a request was started for: an answer for an earlier account
  // (or after the hook went away) is dropped.
  const identity = `${userId ?? ''}|${email ?? ''}`;
  const currentIdentity = useRef(identity);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (resendTimer.current) clearTimeout(resendTimer.current);
    };
  }, []);

  useEffect(() => {
    if (currentIdentity.current === identity) return;
    currentIdentity.current = identity;
    setSent(false);
    setCodeValue('');
    setError(null);
    setNotice(null);
  }, [identity]);

  const run = async (work: (isCurrent: () => boolean) => Promise<void>) => {
    if (busyRef.current) return;
    const started = identity;
    const isCurrent = () => live.current && currentIdentity.current === started;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work(isCurrent);
    } catch (failure) {
      if (isCurrent()) setError(messageOf(failure));
    } finally {
      busyRef.current = false;
      if (live.current) setBusy(false);
    }
  };

  const send = () =>
    run(async (isCurrent) => {
      if (!email || !userId) throw new Error(NO_EMAIL);
      await sendIdentityCode(email);
      if (!isCurrent()) return;
      setNotice(sent ? CODE_SENT : null);
      setSent(true);
      setCodeValue('');
      setCanResend(false);
      if (resendTimer.current) clearTimeout(resendTimer.current);
      resendTimer.current = setTimeout(() => {
        if (live.current) setCanResend(true);
      }, RESEND_COOLDOWN_MS);
    });

  const verify = () =>
    run(async (isCurrent) => {
      if (!email || !userId) throw new Error(NO_EMAIL);
      if (code.length !== IDENTITY_CODE_LENGTH) return;
      const entered = code;
      setCodeValue('');
      await confirmIdentityCode({
        email,
        code: entered,
        expectedUserId: userId,
      });
      if (isCurrent()) onConfirmed();
    });

  return {
    maskedEmail: email ? maskEmail(email) : null,
    sent,
    canResend,
    code,
    busy,
    error,
    notice,
    ready: code.length === IDENTITY_CODE_LENGTH,
    setCode: (value: string) =>
      setCodeValue(value.replace(/[^0-9]/g, '').slice(0, IDENTITY_CODE_LENGTH)),
    send,
    verify,
  };
}
