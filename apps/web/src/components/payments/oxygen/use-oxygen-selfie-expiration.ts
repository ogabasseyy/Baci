'use client';
import { useEffect, useState } from 'react';
import { selfieLinkExpiration, selfieLinkExpired } from './selfie-link-expired';
/** Keeps the pre-camera fallback aware of expiry; hosted recovery owns an open camera. */
export function useOxygenSelfieExpiration(
  url: string | undefined,
  active: boolean,
  required: boolean
) {
  const [lastUsableSelfie, setLastUsableSelfie] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const expiredSelfie = Boolean(url && selfieLinkExpired(url));
  useEffect(() => {
    if (url && !expiredSelfie) setLastUsableSelfie(url);
  }, [url, expiredSelfie]);
  useEffect(() => {
    if (!active || !required || !url || expiredSelfie) return;
    const expiration = selfieLinkExpiration(url);
    if (expiration === null) return;
    const timer = window.setTimeout(
      () => setTick(Date.now()),
      Math.min(Math.max(expiration - Math.max(Date.now(), tick), 1), 2147483647)
    );
    return () => window.clearTimeout(timer);
  }, [url, active, required, expiredSelfie, tick]);
  return {
    expiredSelfie,
    lastUsableSelfie: url && !expiredSelfie ? url : lastUsableSelfie,
  };
}
