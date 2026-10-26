'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { isAnalyticsAllowed } from '@/lib/analytics';
import {
  activateFacebookPixel,
  validFacebookPixelId,
} from '@/lib/analytics/facebook-pixel-client';

interface FacebookPixelProps {
  pixelId: string;
}

const CONSENT_STORAGE_KEY = 'baci-cookie-consent';

// Subscribe to cross-tab and same-tab consent changes. React re-reads the
// snapshot whenever the listener fires, so consent updates flow in without a
// setState-in-effect.
function subscribeToConsent(onChange: () => void): () => void {
  const handleConsentChange = () => {
    onChange();
  };
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === CONSENT_STORAGE_KEY) {
      handleConsentChange();
    }
  };
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('cookie-consent-updated', handleConsentChange);
  return () => {
    window.removeEventListener('storage', handleStorageChange);
    window.removeEventListener('cookie-consent-updated', handleConsentChange);
  };
}

// Server renders with consent denied to stay deterministic during hydration.
const getConsentServerSnapshot = (): boolean => false;

export function FacebookPixel({ pixelId }: FacebookPixelProps) {
  const pathname = usePathname();
  const isAllowed = useSyncExternalStore(
    subscribeToConsent,
    isAnalyticsAllowed,
    getConsentServerSnapshot
  );

  useLayoutEffect(() => {
    if (!isAllowed || !pathname) return;
    return activateFacebookPixel(pixelId);
  }, [pixelId, isAllowed, pathname]);

  if (!validFacebookPixelId(pixelId) || !isAllowed) return null;
  return (
    <Script
      id="facebook-pixel-sdk"
      src="https://connect.facebook.net/en_US/fbevents.js"
      strategy="lazyOnload"
    />
  );
}
