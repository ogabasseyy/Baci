'use client';

import '@/app/(storefront)/storefront-chat.css';
import { Sparkles, X } from 'lucide-react';
import type React from 'react';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { asRoute } from '@/lib/routes';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import { ChatMessageBubble } from './chat-message';
import { ChatInput } from './chat-input';
import { SUGGESTIONS, resolveSuggestionNavigationPath } from './types';
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

  // Suggestion chips with an `href` (e.g. "Repair quote") deep-link to a
  // storefront page instead of sending a chat message.
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

  useEffect(() => {
    if (openOnMount) {
      setIsOpen(true);
    }
  }, [openOnMount, setIsOpen]);

  return (
    <div
      className={anchorClasses}
      data-mobile-offset={mobileOffset}
      {...CHAT_MOBILE_OFFSET_ATTRIBUTES}
    >
      {/* Chat Window */}
      {isOpen && (
        <div
          className={`w-[calc(100vw-32px)] md:w-[400px] h-[400px] md:h-[500px] max-h-[70vh] bg-white rounded-2xl shadow-2xl border ${isSanta ? 'border-red-200' : 'border-gray-200'} overflow-hidden flex flex-col animate-in slide-in-from-bottom-5 fade-in duration-300 origin-bottom-right ring-1 ring-black/5`}
        >
          {/* Header */}
          <div
            className={`relative flex items-center justify-between p-4 border-b ${isSanta
              ? 'bg-red-600 text-white border-red-500'
              : 'bg-white text-gray-800 border-gray-100'
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
                  className="size-9 object-contain rounded-full border-2 border-red-400"
                />
              ) : (
                <Sparkles size={24} className="text-red-600" />
              )}
              <div>
                <h3 className="text-base font-semibold flex items-center gap-1">
                  {isSanta ? (
                    <>
                      Santa AI <span className="text-xs ml-1">{'\u{1F384}'}</span>
                    </>
                  ) : (
                    'Ogabassey AI'
                  )}
                </h3>
                <p className={`text-xs ${isSanta ? 'text-red-100' : 'text-gray-500'}`}>Online</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className={`relative z-10 p-2 rounded-full ${isSanta ? 'hover:bg-red-700/50' : 'hover:bg-gray-100'} transition-colors`}
              aria-label="Close chat"
            >
              <X size={20} />
            </button>
          </div>

          {/* Messages Area */}
          <div
            className={`flex-1 overflow-y-auto p-4 scroll-smooth relative ${isSanta ? 'bg-[#FFF5F5]' : 'bg-[#F8F9FA]'}`}
          >
            <div className="space-y-6 relative z-10">
              <div className="text-center">
                <span
                  className={`text-[10px] font-medium uppercase tracking-widest px-3 py-1 rounded-full ${isSanta ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}
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
                    className={`rounded-2xl rounded-tl-none px-4 py-3 shadow-sm ${isSanta ? 'bg-white border border-red-100' : 'bg-white border border-gray-100'}`}
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

          {/* Input Area */}
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
              Powered by Google Gemini &bull; AI can make mistakes.
            </p>
          </div>
        </div>
      )}

      {/* Floating Toggle Button */}
      <div className="relative group">
        {!isOpen && isSanta && (
          <div className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-32 bg-white px-4 py-3 rounded-2xl rounded-tr-none shadow-xl border-2 border-red-100 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4">
            <p className="text-sm font-bold text-gray-900 text-center leading-tight">
              Make a wish! {'\u2728'}
            </p>
            <div className="absolute -bottom-2 -right-1 size-3 bg-white rounded-full border-r border-b border-red-100" />
            <div className="absolute -bottom-4 -right-3 size-2 bg-white/90 rounded-full border border-red-50" />
          </div>
        )}

        {/* Proactive Nudge Bubble (Standard Mode) */}
        {!isOpen && !isSanta && proactiveMsg && (
          <div className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-48 bg-white px-4 py-3 rounded-2xl rounded-tr-none shadow-lg border border-red-50 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4 z-40">
            <div className="text-gray-800 text-xs font-medium leading-relaxed">{proactiveMsg}</div>
            <div className="absolute -bottom-1.5 -right-1 size-4 bg-white rotate-45 border-r border-b border-red-50" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setProactiveMsg(null);
              }}
              className="absolute -top-2 -left-2 bg-gray-100 hover:bg-gray-200 rounded-full p-1 transition-colors"
            >
              <X size={10} className="text-gray-500" />
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
};
