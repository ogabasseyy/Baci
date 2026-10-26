'use client';

import { useState } from 'react';
import { DeferredChatWidget } from '@/components/storefront/ogabassey/components/chat/DeferredChatWidget';
import { PopupSystem } from '@/components/storefront/ogabassey/components/PopupSystem';
import { V2ThemeProvider } from '@/components/storefront/ogabassey/providers/v2-theme-context';
import { useCookieConsentFocus } from '@/components/storefront/use-cookie-consent-focus';

const loadChatWidget = () =>
  import('@/components/storefront/ogabassey/components/chat/ChatWidget');

export function ChatLauncherFixture() {
  const [showPromotions, setShowPromotions] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const consentFocus = useCookieConsentFocus(showConsent);

  return (
    <V2ThemeProvider initialTheme="standard">
      <main>
        <button type="button" onClick={() => setShowPromotions(true)}>
          Enable timed promotions
        </button>
        <button type="button" onClick={() => setShowConsent(true)}>
          Show consent
        </button>
        {showConsent && (
          <div
            className="storefront-cookie-consent"
            role="dialog"
            aria-label="Cookie consent"
            aria-modal={false}
            ref={consentFocus.bannerRef}
            onFocusCapture={consentFocus.onFocusCapture}
            onBlurCapture={consentFocus.onBlurCapture}
          >
            Cookie preferences
            <button
              type="button"
              onClick={consentFocus.dismissWithFocus(() =>
                setShowConsent(false)
              )}
            >
              Dismiss consent
            </button>
          </div>
        )}
        {showPromotions && <PopupSystem />}
        <DeferredChatWidget loadChatWidget={loadChatWidget} />
      </main>
    </V2ThemeProvider>
  );
}
