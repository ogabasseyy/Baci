'use client';

import { useState } from 'react';
import { DeferredChatWidget } from '@/components/storefront/ogabassey/components/chat/DeferredChatWidget';
import { PopupSystem } from '@/components/storefront/ogabassey/components/PopupSystem';
import { V2ThemeProvider } from '@/components/storefront/ogabassey/providers/v2-theme-context';

const loadChatWidget = () =>
  import('@/components/storefront/ogabassey/components/chat/ChatWidget');

export function ChatLauncherFixture() {
  const [showPromotions, setShowPromotions] = useState(false);

  return (
    <V2ThemeProvider initialTheme="standard">
      <main>
        <button type="button" onClick={() => setShowPromotions(true)}>
          Enable timed promotions
        </button>
        {showPromotions && <PopupSystem />}
        <DeferredChatWidget loadChatWidget={loadChatWidget} />
      </main>
    </V2ThemeProvider>
  );
}
