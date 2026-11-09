'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { selfieLinkExpiration } from './selfie-link-expired';

type Renewal = (
  automatic: boolean,
  signal: AbortSignal
) => Promise<'confirmed' | 'renewed'>;
/** Expiry is a recovery hint only; the bridge checks authoritative completion first. */
export function useOxygenHostedSelfieRenewal(
  url: string,
  enabled: boolean,
  onRenew: Renewal | undefined,
  onConfirmed: () => void
) {
  const [now, setNow] = useState(Date.now);
  const [foreground, setForeground] = useState(
    () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden'
  );
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState('');
  const expiration = selfieLinkExpiration(url);
  const expired =
    expiration !== null && expiration <= Math.max(now, Date.now());
  const latest = useRef({ onRenew, onConfirmed, enabled });
  useLayoutEffect(() => {
    latest.current = { onRenew, onConfirmed, enabled };
  });
  const attempts = useRef(0);
  const automatic = useRef(false);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const replacementTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  useEffect(
    () => () => {
      controller.current?.abort();
      clearTimeout(replacementTimer.current);
    },
    []
  );
  useEffect(() => {
    void url; // A different link starts a new capture/loading session.
    controller.current?.abort();
    controller.current = null;
    clearTimeout(replacementTimer.current);
    automatic.current = false;
    attempts.current = 0;
    locked.current = false;
    setRenewing(false);
    setError('');
  }, [url]);
  useEffect(() => {
    if (!enabled) {
      controller.current?.abort();
      clearTimeout(replacementTimer.current);
      setRenewing(false);
    }
  }, [enabled]);
  useEffect(() => {
    function update() {
      setNow(Date.now());
      setForeground(document.visibilityState !== 'hidden');
    }
    document.addEventListener('visibilitychange', update);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (
      enabled &&
      expiration !== null &&
      expiration > Math.max(now, Date.now())
    )
      timer = setTimeout(update, Math.min(expiration - Date.now(), 2147483647));
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [enabled, expiration, now]);
  async function renew(isAutomatic = false) {
    if (
      !latest.current.enabled ||
      !latest.current.onRenew ||
      locked.current ||
      document.visibilityState === 'hidden'
    )
      return;
    if (attempts.current >= 3) {
      setError('Please return to your saved application and try again later.');
      return;
    }
    attempts.current++;
    locked.current = true;
    setRenewing(true);
    setError('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await latest.current.onRenew(isAutomatic, abort.signal);
      if (abort.signal.aborted) return;
      if (result === 'confirmed') {
        latest.current.onConfirmed();
        setRenewing(false);
      } else
        replacementTimer.current = setTimeout(() => {
          abort.abort();
          setRenewing(false);
          setError('We could not reopen verification. Please try again.');
        }, 5000);
    } catch {
      if (!abort.signal.aborted) {
        setRenewing(false);
        setError(
          'We could not renew your verification session. Please try again.'
        );
      }
    } finally {
      if (controller.current === abort) locked.current = false;
    }
  }
  const retry = useRef(renew);
  useLayoutEffect(() => {
    retry.current = renew;
  });
  useEffect(() => {
    if (
      expired &&
      enabled &&
      onRenew &&
      !automatic.current &&
      foreground &&
      document.visibilityState !== 'hidden'
    ) {
      const timer = setTimeout(() => {
        automatic.current = true;
        void retry.current(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [expired, enabled, onRenew, foreground]);
  return { expired, renewing, error, retry: () => void renew(false) };
}
