'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getStoredConsent, updateConsentMode } from '@/lib/consent-mode';

const COOKIE_CONSENT_KEY = 'baci-cookie-consent';

interface CookiePreferences {
  necessary: boolean; // Always true, required for site functionality
  analytics: boolean; // Google Analytics, etc.
  marketing: boolean; // Ad tracking, retargeting
  functional: boolean; // Preferences, language settings
}

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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    // Check if consent has already been given
    const savedConsent = getStoredConsent();
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

// Listen for consent updates (saveConsent writes localStorage before
// dispatching, so re-reading the snapshot always observes the new value)
function subscribeToConsentUpdates(callback: () => void) {
  window.addEventListener('cookie-consent-updated', callback);
  return () => window.removeEventListener('cookie-consent-updated', callback);
}

function getConsentSnapshot(): string | null {
  return localStorage.getItem(COOKIE_CONSENT_KEY);
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

/**
 * Check if a specific cookie category is allowed
 */
export function isCookieAllowed(category: keyof CookiePreferences): boolean {
  if (typeof window === 'undefined') return false;

  const saved = localStorage.getItem(COOKIE_CONSENT_KEY);
  if (!saved) return false;

  try {
    const consent = JSON.parse(saved) as CookiePreferences;
    return consent[category] ?? false;
  } catch {
    return false;
  }
}
