'use client';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useSyncExternalStore } from 'react';
import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import {
  initializeChatgptPixel,
  measureChatgptPage,
  setChatgptMeasurementConsent,
} from '@/lib/chatgpt-ads/pixel-client';

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('cookie-consent-updated', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('cookie-consent-updated', onChange);
  };
}
const denied = () => false;
export function ChatgptPixel({ pixelId }: { pixelId: string }) {
  const allowed = useSyncExternalStore(subscribe, isAnalyticsAllowed, denied);
  const pathname = usePathname();
  useEffect(() => {
    initializeChatgptPixel(pixelId, isAnalyticsAllowed());
    return () => {
      setChatgptMeasurementConsent(false);
    };
  }, [pixelId]);
  useEffect(() => {
    // The hydration snapshot is denied even when browser consent is saved.
    // Only the current browser choice may withdraw SDK consent and its cookies.
    if (allowed === isAnalyticsAllowed()) {
      setChatgptMeasurementConsent(allowed);
    }
  }, [allowed]);
  useEffect(() => {
    if (allowed && pathname) measureChatgptPage(pixelId);
  }, [pixelId, allowed, pathname]);
  return allowed ? (
    <Script
      id="chatgpt-measurement-sdk"
      src="https://bzrcdn.openai.com/sdk/oaiq.min.js"
      strategy="afterInteractive"
    />
  ) : null;
}
