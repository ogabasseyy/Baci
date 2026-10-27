'use client';

import { parseCookiePreferences } from '@/components/storefront/parse-cookie-preferences';

/**
 * Google Consent Mode v2 Implementation
 *
 * Required for EU compliance starting March 2024.
 * This must be initialized BEFORE any Google tags load.
 *
 * @see https://developers.google.com/tag-platform/security/guides/consent
 */

// Consent state types matching Google's specification
export type ConsentState = 'granted' | 'denied';

export interface ConsentSettings {
  ad_storage: ConsentState;
  ad_user_data: ConsentState;
  ad_personalization: ConsentState;
  analytics_storage: ConsentState;
  functionality_storage: ConsentState;
  personalization_storage: ConsentState;
  security_storage: ConsentState;
}

// Default consent state - deny all by default (required for GDPR)
const DEFAULT_CONSENT: ConsentSettings = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  functionality_storage: 'granted', // Required for basic site functionality
  personalization_storage: 'denied',
  security_storage: 'granted', // Required for security features
};

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Initialize Google Consent Mode v2 with default denied state
 * This MUST be called before gtag.js loads
 */
export function initializeConsentMode(): void {
  if (typeof window === 'undefined') return;

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || [];

  // Define gtag function
  window.gtag = function gtag() {
    // biome-ignore lint/complexity/noArguments: Google Tag Manager pattern
    window.dataLayer.push(arguments);
  };

  // Set default consent state BEFORE any tags fire
  window.gtag('consent', 'default', {
    ...DEFAULT_CONSENT,
    wait_for_update: 500, // Wait 500ms for consent banner interaction
  });

  // Set region-specific defaults (stricter for EU/EEA)
  window.gtag('consent', 'default', {
    ...DEFAULT_CONSENT,
    region: [
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FI',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LT',
      'LU',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE',
      'GB',
      'IS',
      'LI',
      'NO',
    ],
  });
}

/**
 * Update consent state when user makes a choice
 */
export function updateConsentMode(preferences: {
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
}): void {
  if (typeof window === 'undefined' || !window.gtag) return;

  const consentUpdate: ConsentSettings = {
    ad_storage: preferences.marketing ? 'granted' : 'denied',
    ad_user_data: preferences.marketing ? 'granted' : 'denied',
    ad_personalization: preferences.marketing ? 'granted' : 'denied',
    analytics_storage: preferences.analytics ? 'granted' : 'denied',
    functionality_storage: preferences.functional ? 'granted' : 'denied',
    personalization_storage: preferences.functional ? 'granted' : 'denied',
    security_storage: 'granted', // Always granted
  };

  window.gtag('consent', 'update', consentUpdate);

  // Also update Facebook's data processing options for CCPA/GDPR
  if (window.fbq) {
    if (preferences.marketing) {
      window.fbq('dataProcessingOptions', []); // Enable full data processing
    } else {
      // Limited data use for California (CCPA) - state code 1000, country 0
      window.fbq('dataProcessingOptions', ['LDU'], 1, 1000);
    }
  }
}

/**
 * Get current consent state from localStorage
 */
export function getStoredConsent(): {
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
} | null {
  if (typeof window === 'undefined') return null;

  try {
    const saved = localStorage.getItem('baci-cookie-consent');
    if (!saved) return null;
    return parseCookiePreferences(JSON.parse(saved));
  } catch {
    return null;
  }
}

/**
 * Check if consent has been given and apply it
 */
export function applyStoredConsent(): void {
  const consent = getStoredConsent();
  if (consent) {
    updateConsentMode(consent);
  }
}
