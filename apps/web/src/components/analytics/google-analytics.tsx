'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { applyStoredConsent, initializeConsentMode } from '@/lib/consent-mode';
import { TRACKING_URL_INLINE_SANITIZER } from '@/lib/privacy/tracking-url-inline-sanitizer';

interface GoogleAnalyticsProps {
  measurementId: string;
}

/**
 * Google Analytics 4 Component with Consent Mode v2
 *
 * Key features:
 * - Initializes Consent Mode v2 BEFORE gtag.js loads (required for compliance)
 * - Respects user cookie preferences
 * - Supports Enhanced Conversions when user data is available
 *
 * @see https://developers.google.com/analytics/devguides/collection/ga4
 */
export function GoogleAnalytics({ measurementId }: GoogleAnalyticsProps) {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Initialize Consent Mode v2 BEFORE gtag loads
    // This sets default denied state for all consent types
    initializeConsentMode();

    // Apply any stored consent preferences
    applyStoredConsent();

    // Flip the render gate off the synchronous effect body (microtask) so the
    // compiler can memoize this component; the consent init above still runs
    // first, preserving the required ordering before gtag.js renders.
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setIsInitialized(true);
      }
    });

    // Listen for consent updates
    const handleConsentUpdate = () => {
      applyStoredConsent();
    };

    window.addEventListener('storage', handleConsentUpdate);
    window.addEventListener('cookie-consent-updated', handleConsentUpdate);

    return () => {
      active = false;
      window.removeEventListener('storage', handleConsentUpdate);
      window.removeEventListener('cookie-consent-updated', handleConsentUpdate);
    };
  }, []);

  // Don't render scripts until consent mode is initialized
  if (!measurementId || !isInitialized) {
    return null;
  }

  return (
    <>
      {/* Load gtag.js AFTER consent mode is initialized */}
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="lazyOnload"
      />
      <Script id="google-analytics" strategy="lazyOnload">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          ${TRACKING_URL_INLINE_SANITIZER}
          gtag('js', new Date());

          // Configure GA4 with enhanced measurement. The page address and
          // referrer are sent without order tokens or shopper details.
          gtag('config', '${measurementId}', {
            page_location: baciSanitizeUrl(window.location.href),
            page_referrer: baciSanitizeUrl(document.referrer) || undefined,
            page_title: document.title,
            // Enable URL passthrough for better attribution without cookies
            url_passthrough: true,
            // Enable ads data redaction when consent is denied
            ads_data_redaction: true,
            // Send page views automatically
            send_page_view: true
          });
        `}
      </Script>
    </>
  );
}

/**
 * Send Enhanced Conversion data to GA4
 * Call this on purchase with hashed user data for better attribution
 *
 * @see https://developers.google.com/google-ads/api/docs/conversions/enhance-conversions
 */
export function sendEnhancedConversion(userData: {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}): void {
  if (typeof window === 'undefined' || !window.gtag) return;

  // Hash function using SHA-256 (must be done client-side for Enhanced Conversions)
  const hashData = async (data: string): Promise<string> => {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  // Build enhanced conversion data
  const buildUserData = async () => {
    const enhancedData: Record<string, string> = {};

    if (userData.email) {
      enhancedData.sha256_email_address = await hashData(userData.email);
    }
    if (userData.phone) {
      // Normalize phone: remove spaces, dashes, parentheses
      const normalizedPhone = userData.phone.replace(/[\s\-()]/g, '');
      enhancedData.sha256_phone_number = await hashData(normalizedPhone);
    }
    if (userData.firstName) {
      enhancedData.sha256_first_name = await hashData(userData.firstName);
    }
    if (userData.lastName) {
      enhancedData.sha256_last_name = await hashData(userData.lastName);
    }
    if (userData.street) {
      enhancedData.sha256_street = await hashData(userData.street);
    }

    // Non-hashed fields
    if (userData.city) enhancedData.city = userData.city;
    if (userData.region) enhancedData.region = userData.region;
    if (userData.postalCode) enhancedData.postal_code = userData.postalCode;
    if (userData.country) enhancedData.country = userData.country;

    return enhancedData;
  };

  buildUserData()
    .then((enhancedData) => {
      if (window.gtag) {
        window.gtag('set', 'user_data', enhancedData);
      }
    })
    .catch(console.error);
}
