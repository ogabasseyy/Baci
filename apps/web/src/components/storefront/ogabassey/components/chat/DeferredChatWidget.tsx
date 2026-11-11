'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { StorefrontChatStyleLoader } from '@/app/(storefront)/storefront-chat-style-loader';
import { useCart } from '@/hooks/cart';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import { EkaetteAskBar } from './EkaetteAskBar';
import type { ChatWidgetProps } from './ChatWidget';

interface ChatWidgetModule {
  ChatWidget: React.ComponentType<ChatWidgetProps>;
}

interface DeferredChatWidgetProps {
  loadChatWidget?: () => Promise<ChatWidgetModule>;
}

const CHAT_MOBILE_OFFSET_ATTRIBUTES = {
  'data-mobile-offset-cart': '6.75rem',
  'data-mobile-offset-default': '1rem',
  'data-mobile-offset-product': '1rem',
  'data-mobile-offset-screen': '1rem',
} as const;

// Module-scope so the dynamic import() expression stays outside the component
// body (React Compiler cannot lower import expressions). Code splitting is
// unaffected: the chunk still loads on first activation only.
const loadDefaultChatWidget = () => import('./ChatWidget');

function getMobileOffset(pathname: string | null) {
  const isProductPage =
    pathname?.match(/\/[^/]+\/[^/]+\/[^/]+/) &&
    !pathname.includes('/cart') &&
    !pathname.includes('/checkout');
  const isCartPage = pathname?.includes('/cart');

  if (isProductPage) {
    return 'product';
  }

  if (isCartPage) {
    return 'cart';
  }

  return 'default';
}

export function DeferredChatWidget({
  loadChatWidget,
}: DeferredChatWidgetProps) {
  const { isCartOpen } = useCart();
  const { theme } = useV2Theme();
  const pathname = usePathname();
  const isFooterVisible = useOgabasseyScrollVisibility();
  const [ChatRuntime, setChatRuntime] =
    useState<ChatWidgetModule['ChatWidget'] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [submittedDraft, setSubmittedDraft] = useState<string | undefined>();

  const isSanta = theme === 'santa';
  const footerOffset = getMobileOffset(pathname);
  const mobileOffset = isFooterVisible ? footerOffset : 'screen';
  const anchorClasses = [
    'ogabassey-chat-anchor',
    !isSanta && 'ogabassey-chat-anchor--ask',
    isCartOpen && 'ogabassey-chat-anchor--hidden',
  ]
    .filter(Boolean)
    .join(' ');
  const buttonClasses = [
    'ogabassey-chat-button',
    isSanta && 'ogabassey-chat-button--santa',
    isLoading && 'ogabassey-chat-button--loading',
  ]
    .filter(Boolean)
    .join(' ');

  const activateChat = (message?: string) => {
    if (ChatRuntime || isLoading) {
      return;
    }

    setLoadError(null);
    setIsLoading(true);
    const resolveChatWidget = loadChatWidget ?? loadDefaultChatWidget;

    void resolveChatWidget()
      .then((module) => {
        if (message?.trim()) {
          setSubmittedDraft(message.trim());
        }
        setChatRuntime(() => module.ChatWidget);
      })
      .catch(() => {
        setLoadError('Could not open Ekaette. Your question is saved; try again.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  if (ChatRuntime) {
    return <ChatRuntime openOnMount initialMessage={submittedDraft} />;
  }

  return (
    <div
      className={anchorClasses}
      data-mobile-offset={mobileOffset}
      {...CHAT_MOBILE_OFFSET_ATTRIBUTES}
    >
      <StorefrontChatStyleLoader />
      {!isSanta ? (
        <EkaetteAskBar
          error={loadError}
          isLoading={isLoading}
          onChange={setDraft}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() && !isLoading) activateChat(draft);
          }}
          value={draft}
        />
      ) : (
        <div className="relative group">
          <button
            type="button"
            onClick={() => activateChat()}
            disabled={isLoading}
            className={buttonClasses}
            aria-label="Open AI chat assistant"
          >
            <div className="relative w-full h-full">
              <img
                src="/african-santa-head.svg"
                alt="Santa"
                className="w-full h-full object-contain drop-shadow-xl hover:brightness-110 transition-all filter"
              />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
