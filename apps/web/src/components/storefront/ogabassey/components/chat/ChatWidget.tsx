'use client';

import '@/app/(storefront)/storefront-chat.css';
import { Sparkles, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import type React from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { asRoute } from '@/lib/routes';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import { ChatInput } from './chat-input';
import { ChatMessageBubble } from './chat-message';
import { resolveSuggestionNavigationPath, SUGGESTIONS } from './types';
import { useChatOpenOnMount } from './use-chat-open-on-mount';
import { useOgabasseyChat } from './use-ogabassey-chat';

export interface ChatWidgetProps {
  openOnMount?: boolean;
}

const CHAT_MOBILE_OFFSET_ATTRIBUTES = {
  'data-mobile-offset-cart': '6.75rem',
  'data-mobile-offset-default': '5.75rem',
  'data-mobile-offset-product': '6.25rem',
  'data-mobile-offset-screen': '1rem',
} as const;

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  openOnMount = false,
}) => {
  const { isCartOpen } = useCart();
  const { theme } = useV2Theme();
  const pathname = usePathname();
  const router = useRouter();
  const merchant = useMerchantSafe();
  const isFooterVisible = useOgabasseyScrollVisibility();

  const isSanta = theme === 'santa';

  const {
    isOpen,
    setIsOpen,
    messages,
    input,
    setInput,
    isLoading,
    proactiveMsg,
    setProactiveMsg,
    messagesEndRef,
    handleSend,
    handleSubmit,
    handleAddSantaWishToCart,
  } = useOgabasseyChat({
    isSanta,
    storefrontSlug: merchant?.merchant?.slug,
  });

  const handleSuggestionClick = (label: string) => {
    const suggestion = SUGGESTIONS.find((entry) => entry.label === label);
    const navigationPath = suggestion
      ? resolveSuggestionNavigationPath(suggestion, merchant?.basePath ?? '')
      : null;

    if (navigationPath) {
      setIsOpen(false);
      router.push(asRoute(navigationPath));
      return;
    }

    handleSend(label);
  };

  // Dynamic bottom positioning based on page type
  const isProductPage =
    pathname?.match(/\/[^/]+\/[^/]+\/[^/]+/) &&
    !pathname?.includes('/cart') &&
    !pathname?.includes('/checkout');
  const isCartPage = pathname?.includes('/cart');

  const footerOffset = isProductPage
    ? 'product'
    : isCartPage
      ? 'cart'
      : 'default';
  const mobileOffset = isFooterVisible ? footerOffset : 'screen';
  const anchorClasses = [
    'ogabassey-chat-anchor',
    isCartOpen && 'ogabassey-chat-anchor--hidden',
  ]
    .filter(Boolean)
    .join(' ');
  const buttonClasses = [
    'ogabassey-chat-button',
    isOpen && 'ogabassey-chat-button--open',
    isSanta && 'ogabassey-chat-button--santa',
  ]
    .filter(Boolean)
    .join(' ');

  useChatOpenOnMount(openOnMount, setIsOpen);

  return (
    <div
      className={anchorClasses}
      data-mobile-offset={mobileOffset}
      {...CHAT_MOBILE_OFFSET_ATTRIBUTES}
    >
      {isOpen && (
        <div
          className={`w-[calc(100vw-32px)] md:w-[400px] h-[400px] md:h-[500px] max-h-[70vh] bg-store-background rounded-2xl shadow-2xl border ${isSanta ? 'border-store-primary/20' : 'border-store-border'} overflow-hidden flex flex-col animate-in slide-in-from-bottom-5 fade-in duration-300 origin-bottom-right ring-1 ring-store-background-text/5`}
        >
          <div
            className={`relative flex items-center justify-between p-4 border-b ${
              isSanta
                ? 'bg-store-primary text-store-primary-text border-store-primary/50'
                : 'bg-store-background text-store-background-text border-store-border'
            }`}
          >
            {isSanta && (
              <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 50% 120%, rgba(255, 255, 255, 0.4) 10%, transparent 80%)',
                }}
              />
            )}

            <div className="relative z-10 flex items-center gap-3">
              {isSanta ? (
                <img
                  src="/african-santa-head.svg"
                  alt="Santa"
                  className="size-9 object-contain rounded-full border-2 border-store-primary/40"
                />
              ) : (
                <Sparkles size={24} className="text-store-primary" />
              )}
              <div>
                <h3 className="text-base font-semibold flex items-center gap-1">
                  {isSanta ? (
                    <>
                      Santa AI{' '}
                      <span className="text-xs ml-1">{'\u{1F384}'}</span>
                    </>
                  ) : (
                    'Ogabassey AI'
                  )}
                </h3>
                <p
                  className={`text-xs ${isSanta ? 'text-store-primary-text/90' : 'text-store-background-text/70'}`}
                >
                  Shopping assistant
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className={`relative z-10 p-2 rounded-full ${isSanta ? 'hover:bg-store-primary/80' : 'hover:bg-store-background-text/5'} transition-colors`}
              aria-label="Close chat"
            >
              <X size={20} />
            </button>
          </div>

          <div
            className={`flex-1 overflow-y-auto p-4 scroll-smooth relative ${isSanta ? 'bg-store-primary/5' : 'bg-store-background'}`}
          >
            <div className="space-y-6 relative z-10">
              <div className="text-center">
                <span
                  className={`text-[10px] font-medium uppercase tracking-widest px-3 py-1 rounded-full ${isSanta ? 'bg-store-primary/10 text-store-primary' : 'bg-store-background-text/5 text-store-background-text/60'}`}
                >
                  Today
                </span>
              </div>

              {messages.map((msg, idx) => (
                <ChatMessageBubble
                  key={idx}
                  message={msg}
                  index={idx}
                  isSanta={isSanta}
                  onAddToCart={handleAddSantaWishToCart}
                />
              ))}

              {isLoading && (
                <div className="flex justify-start animate-in fade-in zoom-in duration-300">
                  <div
                    className={`rounded-2xl rounded-tl-none px-4 py-3 shadow-sm ${isSanta ? 'bg-store-background border border-store-primary/10' : 'bg-store-background border border-store-border'}`}
                  >
                    <div className="flex gap-1">
                      <span
                        className={`w-1.5 h-1.5 rounded-full animate-bounce ${isSanta ? 'bg-red-400' : 'bg-gray-400'}`}
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full animate-bounce ${isSanta ? 'bg-red-400' : 'bg-gray-400'}`}
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full animate-bounce ${isSanta ? 'bg-red-400' : 'bg-gray-400'}`}
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <ChatInput
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            isSanta={isSanta}
            showSuggestions={messages.length < 3 && !isLoading}
            onSubmit={handleSubmit}
            onSuggestionClick={handleSuggestionClick}
          />
          <div className="text-center mt-2">
            <p className="text-[10px] text-gray-300">
              AI can make mistakes. Check product details before buying.
            </p>
          </div>
        </div>
      )}

      <div className="relative group">
        {!isOpen && isSanta && (
          <div className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-32 bg-store-background px-4 py-3 rounded-2xl rounded-tr-none shadow-xl border-2 border-store-primary/10 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4">
            <p className="text-sm font-bold text-store-background-text text-center leading-tight">
              Make a wish! {'\u2728'}
            </p>
            <div className="absolute -bottom-2 -right-1 size-3 bg-store-background rounded-full border-r border-b border-store-primary/10" />
            <div className="absolute -bottom-4 -right-3 size-2 bg-store-background/90 rounded-full border border-store-primary/10" />
          </div>
        )}

        {/* Proactive Nudge Bubble (Standard Mode) */}
        {!isOpen && !isSanta && proactiveMsg && (
          <div className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-48 bg-store-background px-4 py-3 rounded-2xl rounded-tr-none shadow-lg border border-store-primary/10 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4 z-40">
            <div className="text-store-background-text text-xs font-medium leading-relaxed">
              {proactiveMsg}
            </div>
            <div className="absolute -bottom-1.5 -right-1 size-4 bg-store-background rotate-45 border-r border-b border-store-primary/10" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setProactiveMsg(null);
              }}
              aria-label="Dismiss chat suggestion"
              className="absolute -top-2 -left-2 bg-store-background-text/5 hover:bg-store-background-text/10 rounded-full p-1 transition-colors"
            >
              <X size={10} className="text-store-background-text/70" />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={buttonClasses}
          aria-label="Toggle chat"
        >
          {isOpen ? (
            <X size={28} />
          ) : (
            <>
              {isSanta ? (
                <div className="relative w-full h-full">
                  <img
                    src="/african-santa-head.svg"
                    alt="Santa"
                    className="w-full h-full object-contain drop-shadow-xl hover:brightness-110 transition-all filter"
                  />
                </div>
              ) : (
                <Sparkles
                  size={28}
                  className="md:w-8 md:h-8 drop-shadow-xs"
                  fill="currentColor"
                  fillOpacity={0.1}
                />
              )}
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
};
