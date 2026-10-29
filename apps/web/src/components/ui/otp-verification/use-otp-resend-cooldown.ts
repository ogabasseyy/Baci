'use client';

import { useOtpExpiry } from './use-otp-expiry';

/** The caller owns sentAt; failed sends never move the cooldown deadline. */
export function useOtpResendCooldown(
  sentAt: number | undefined,
  seconds: number,
  running = true
) {
  const active = sentAt !== undefined && Number.isFinite(sentAt) && seconds > 0;
  const expiry = useOtpExpiry(
    active ? sentAt : undefined,
    active ? seconds : 1,
    running
  );
  const blocked = active && (!expiry.ready || !expiry.expired);
  return {
    remainingSeconds: blocked ? (expiry.remainingSeconds ?? seconds) : 0,
    canResend: () =>
      !blocked && (!active || Date.now() >= sentAt + seconds * 1000),
  };
}
