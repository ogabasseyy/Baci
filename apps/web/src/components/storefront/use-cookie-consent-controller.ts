'use client';

import { useEffect, useRef, useState } from 'react';
import { getStoredConsent, updateConsentMode } from '@/lib/consent-mode';

import {
  COOKIE_CONSENT_KEY,
  type CookiePreferences,
} from './cookie-consent-types';
import { parseCookiePreferences } from './parse-cookie-preferences';

const defaultPreferences: CookiePreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
  functional: true,
};

/** Owns consent persistence, prompt timing and preference actions. */
export function useCookieConsentController() {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [hasStorageError, setHasStorageError] = useState(false);
  const [preferences, setPreferences] =
    useState<CookiePreferences>(defaultPreferences);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check if consent has already been given
    const savedConsent = parseCookiePreferences(getStoredConsent());
    if (!savedConsent) {
      // Small delay to prevent flash on page load
      const timer = setTimeout(() => setIsVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Clean up exit animation timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const saveConsent = (prefs: CookiePreferences) => {
    try {
      localStorage.setItem(
        COOKIE_CONSENT_KEY,
        JSON.stringify({
          ...prefs,
          timestamp: new Date().toISOString(),
        })
      );
    } catch {
      // Do not grant tracking consent until the choice is persisted.
      setHasStorageError(true);
      return;
    }
    setHasStorageError(false);

    // Trigger exit animation, then unmount after it completes
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => setIsVisible(false), 200);

    // Update Google Consent Mode v2
    updateConsentMode({
      analytics: prefs.analytics,
      marketing: prefs.marketing,
      functional: prefs.functional,
    });

    // Dispatch event for analytics to pick up
    window.dispatchEvent(
      new CustomEvent('cookie-consent-updated', {
        detail: prefs,
      })
    );
  };

  const acceptAll = () => {
    const allAccepted: CookiePreferences = {
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true,
    };
    setPreferences(allAccepted);
    saveConsent(allAccepted);
  };

  const acceptNecessary = () => {
    saveConsent(defaultPreferences);
  };

  const savePreferences = () => {
    saveConsent(preferences);
  };

  return {
    isVisible,
    isClosing,
    showDetails,
    setShowDetails,
    hasStorageError,
    preferences,
    setPreferences,
    acceptAll,
    acceptNecessary,
    savePreferences,
  };
}
