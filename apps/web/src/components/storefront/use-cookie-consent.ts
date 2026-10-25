'use client';

import { useSyncExternalStore } from 'react';
import {
  COOKIE_CONSENT_KEY,
  type CookiePreferences,
} from './cookie-consent-types';

// Listen for consent updates (saveConsent writes localStorage before
// dispatching, so re-reading the snapshot always observes the new value)
function subscribeToConsentUpdates(callback: () => void) {
  window.addEventListener('cookie-consent-updated', callback);
  return () => window.removeEventListener('cookie-consent-updated', callback);
}

function getConsentSnapshot(): string | null {
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY);
  } catch {
    return null;
  }
}

function getConsentServerSnapshot(): string | null {
  return null;
}

/**
 * Hook to check cookie consent status
 */
export function useCookieConsent(): CookiePreferences | null {
  const savedConsent = useSyncExternalStore(
    subscribeToConsentUpdates,
    getConsentSnapshot,
    getConsentServerSnapshot
  );

  if (!savedConsent) return null;

  try {
    return JSON.parse(savedConsent) as CookiePreferences;
  } catch {
    return null;
  }
}
