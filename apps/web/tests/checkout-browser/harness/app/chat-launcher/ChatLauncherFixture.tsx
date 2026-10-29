'use client';

import { useState } from 'react';
import { CookieConsent } from '@/components/storefront/cookie-consent';
import { DeferredChatWidget } from '@/components/storefront/ogabassey/components/chat/DeferredChatWidget';
import { PopupSystem } from '@/components/storefront/ogabassey/components/PopupSystem';
import { V2ThemeProvider } from '@/components/storefront/ogabassey/providers/v2-theme-context';

const loadChatWidget = () =>
  import('@/components/storefront/ogabassey/components/chat/ChatWidget');

export function ChatLauncherFixture() {
  const [showPromotions, setShowPromotions] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [showNewsletter, setShowNewsletter] = useState(false);

  return (
    <V2ThemeProvider initialTheme="standard">
      <main>
        <button type="button">Focus origin</button>
        <button type="button" onClick={() => setShowPromotions(true)}>
          Enable timed promotions
        </button>
        <button type="button" onClick={() => setShowConsent(true)}>
          Show consent
        </button>
        <button type="button" onClick={() => setShowNewsletter(true)}>
          Show newsletter
        </button>
        {showConsent && <CookieConsent />}
        {showNewsletter && (
          <div className="ogabassey-newsletter-popup">
            <button
              type="button"
              aria-label="Dismiss newsletter popup backdrop"
              tabIndex={-1}
            >
              Backdrop
            </button>
            <button type="button" aria-label="Close newsletter">
              Close newsletter
            </button>
          </div>
        )}
        {showPromotions && <PopupSystem />}
        <DeferredChatWidget loadChatWidget={loadChatWidget} />
        <button type="button">Page control after assistant</button>
      </main>
    </V2ThemeProvider>
  );
}
