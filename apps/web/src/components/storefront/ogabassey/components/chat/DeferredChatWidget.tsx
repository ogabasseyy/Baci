'use client';

import { RotateCw, Sparkles } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { StorefrontChatStyleLoader } from '@/app/(storefront)/storefront-chat-style-loader';
import { useCart } from '@/hooks/cart';
import { CHAT_MOBILE_OFFSET_ATTRIBUTES } from '../../config/chat-mobile-offsets';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import type { ChatWidgetProps } from './ChatWidget';
import { getChatMobileOffset } from './get-chat-mobile-offset';
import { useChatLauncherDrag } from './use-chat-launcher-drag';
import { useChatPromotionFocusHandoff } from './use-chat-promotion-focus-handoff';

interface ChatWidgetModule {
  ChatWidget: React.ComponentType<ChatWidgetProps>;
}

interface DeferredChatWidgetProps {
  loadChatWidget?: () => Promise<ChatWidgetModule>;
}

// Module-scope so the dynamic import() expression stays outside the component
// body (React Compiler cannot lower import expressions). Code splitting is
// unaffected: the chunk still loads on first activation only.
const loadDefaultChatWidget = () => import('./ChatWidget');

export function DeferredChatWidget({
  loadChatWidget,
}: DeferredChatWidgetProps) {
  useChatPromotionFocusHandoff();
  const { isCartOpen } = useCart();
  const { theme } = useV2Theme();
  const pathname = usePathname();
  const isFooterVisible = useOgabasseyScrollVisibility();
  const [ChatRuntime, setChatRuntime] = useState<
    ChatWidgetModule['ChatWidget'] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const focusLauncherOnMount = useRef(false);

  const isSanta = theme === 'santa';
  const footerOffset = getChatMobileOffset(pathname);
  const mobileOffset = isFooterVisible ? footerOffset : 'screen';
  const drag = useChatLauncherDrag(
    undefined,
    false,
    false,
    isCartOpen,
    mobileOffset,
  );
  useEffect(() => {
    if (!isLoading && loadFailed && focusLauncherOnMount.current) {
      const launcher = drag.buttonRef.current;
      const activeElement = document.activeElement;
      if (
        launcher &&
        (!activeElement ||
          activeElement === document.body ||
          activeElement === launcher ||
          !activeElement.isConnected)
      ) {
        launcher.focus();
      }
      focusLauncherOnMount.current = false;
    }
  }, [drag.buttonRef, isLoading, loadFailed]);
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
    loadFailed && 'ogabassey-chat-button--retry',
  ]
    .filter(Boolean)
    .join(' ');

  const activateChat = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (drag.suppressClick(event) || ChatRuntime || isLoading) {
      return;
    }

    focusLauncherOnMount.current = event.detail === 0;
    setLoadFailed(false);
    setIsLoading(true);
    const resolveChatWidget = loadChatWidget ?? loadDefaultChatWidget;

    void resolveChatWidget()
      .then((module) => {
        setChatRuntime(() => module.ChatWidget);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => {
        setIsLoading(false);
      });
  };

  if (ChatRuntime) {
    return (
      <ChatRuntime
        openOnMount
        focusLauncherOnMount={focusLauncherOnMount.current}
        initialLauncherPosition={drag.position}
      />
    );
  }

  return (
    <div
      ref={drag.anchorRef}
      style={drag.anchorStyle}
      className={anchorClasses}
      data-mobile-offset={mobileOffset}
      {...CHAT_MOBILE_OFFSET_ATTRIBUTES}
    >
      <StorefrontChatStyleLoader />
      <div className="relative group">
        <button
          {...drag.buttonProps}
          type="button"
          onClick={activateChat}
          disabled={isLoading}
          className={buttonClasses}
          aria-label={
            loadFailed
              ? 'Chat did not load. Activate to retry.'
              : 'Open AI chat assistant'
          }
          title={
            loadFailed ? 'Chat did not load. Activate to retry.' : undefined
          }
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          aria-describedby={
            loadFailed
              ? 'ogabassey-deferred-chat-keyboard-help ogabassey-deferred-chat-load-error'
              : 'ogabassey-deferred-chat-keyboard-help'
          }
        >
          <span
            id="ogabassey-deferred-chat-keyboard-help"
            className="sr-only"
          >
            Use arrow keys to move the assistant launcher. Hold Shift for
            48-pixel steps.
          </span>
          {loadFailed && (
            <span
              id="ogabassey-deferred-chat-load-error"
              className="sr-only"
              role="status"
            >
              Chat did not load. Activate again to retry.
            </span>
          )}
          {loadFailed ? (
            <span
              className="ogabassey-chat-retry-indicator"
              aria-hidden="true"
            >
              <RotateCw size={15} />
              <span>Retry</span>
            </span>
          ) : isSanta ? (
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
                <span className="ogabassey-chat-badge__label">AI</span>
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
