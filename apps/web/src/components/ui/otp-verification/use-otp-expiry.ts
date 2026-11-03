'use client';
import { useEffect, useState } from 'react';

export const OTP_CODE_TTL_SECONDS = 5 * 60;
/** Absolute send time is owned by the caller; mounting never starts a new window. */
export function useOtpExpiry(
  sentAt?: number,
  ttlSeconds = OTP_CODE_TTL_SECONDS,
  running = true
) {
  const [now, setNow] = useState<number | null>(null);
  const invalid =
    sentAt !== undefined &&
    (!Number.isFinite(sentAt) ||
      !Number.isFinite(ttlSeconds) ||
      ttlSeconds <= 0);
  const expiresAt =
    sentAt === undefined || invalid ? null : sentAt + ttlSeconds * 1000;
  useEffect(() => {
    if (expiresAt === null || !running) return;
    setNow(Date.now());
    if (Date.now() >= expiresAt) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, running]);
  return {
    ready: expiresAt === null || now !== null,
    expiresAt,
    expired:
      invalid || (expiresAt !== null && now !== null && now >= expiresAt),
    remainingSeconds:
      expiresAt === null || now === null
        ? null
        : Math.max(0, Math.ceil((expiresAt - now) / 1000)),
  };
}
