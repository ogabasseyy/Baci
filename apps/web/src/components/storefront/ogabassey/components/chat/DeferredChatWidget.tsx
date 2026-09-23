'use client';

import { Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { StorefrontChatStyleLoader } from '@/app/(storefront)/storefront-chat-style-loader';
import { useCart } from '@/hooks/cart';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import type { ChatWidgetProps } from './ChatWidget';

interface ChatWidgetModule {
  ChatWidget: React.ComponentType<ChatWidgetProps>;
}

interface DeferredChatWidgetProps {
  loadChatWidget?: () => Promise<ChatWidgetModule>;
}

const CHAT_MOBILE_OFFSET_ATTRIBUTES = {
  'data-mobile-offset-cart': '6.75rem',
  'data-mobile-offset-default': '5.75rem',
  'data-mobile-offset-product': '6.25rem',
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

  const isSanta = theme === 'santa';
  const footerOffset = getMobileOffset(pathname);
  const mobileOffset = isFooterVisible ? footerOffset : 'screen';
  const anchorClasses = [
    'ogabassey-chat-anchor',
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

  const activateChat = () => {
    if (ChatRuntime || isLoading) {
      return;
    }

    setIsLoading(true);
    const resolveChatWidget = loadChatWidget ?? loadDefaultChatWidget;

    void resolveChatWidget()
      .then((module) => {
        setChatRuntime(() => module.ChatWidget);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  if (ChatRuntime) {
    return <ChatRuntime openOnMount />;
  }

  return (
    <div
      className={anchorClasses}
      data-mobile-offset={mobileOffset}
      {...CHAT_MOBILE_OFFSET_ATTRIBUTES}
    >
      <StorefrontChatStyleLoader />
      <div className="relative group">
        <button
          type="button"
          onClick={activateChat}
          disabled={isLoading}
          className={buttonClasses}
          aria-label="Open AI chat assistant"
        >
          {isSanta ? (
            <div className="relative w-full h-full">
              <img
                src="/african-santa-head.svg"
                alt="Santa"
                className="w-full h-full object-contain drop-shadow-xl hover:brightness-110 transition-all filter"
              />
            </div>
          ) : (
            <>
              <Sparkles
                size={28}
                className="md:w-8 md:h-8 drop-shadow-xs"
                fill="currentColor"
                fillOpacity={0.1}
              />
              <span className="ogabassey-chat-badge">
                <span className="ogabassey-chat-badge__ping" />
                <span className="ogabassey-chat-badge__label">
                  AI
                </span>
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
