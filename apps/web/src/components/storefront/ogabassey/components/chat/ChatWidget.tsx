'use client';

import '@/app/(storefront)/storefront-chat.css';
import { Sparkles, X } from 'lucide-react';
import type React from 'react';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { asRoute } from '@/lib/routes';
import { CHAT_MOBILE_OFFSET_ATTRIBUTES } from '../../config/chat-mobile-offsets';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import { ChatMessageBubble } from './chat-message';
import { ChatInput } from './chat-input';
import { SUGGESTIONS, resolveSuggestionNavigationPath } from './types';
import { getChatMobileOffset } from './get-chat-mobile-offset';
import { ChatLauncher } from './ChatLauncher';
import { useChatLauncherDrag } from './use-chat-launcher-drag';
import { useOgabasseyChat } from './use-ogabassey-chat';

export interface ChatWidgetProps {
  openOnMount?: boolean;
  initialLauncherPosition?: { x: number; y: number };
}

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  openOnMount = false,
  initialLauncherPosition,
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
  const footerOffset = getChatMobileOffset(pathname);
  const mobileOffset = isFooterVisible ? footerOffset : 'screen';

  const launcherOverflowKey = isOpen
    ? false
    : isSanta
      ? 'santa'
      : proactiveMsg || false;
  const drag = useChatLauncherDrag(
    initialLauncherPosition,
    isOpen,
    launcherOverflowKey,
    isCartOpen,
    mobileOffset,
  );

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

  const anchorClasses = [
    'ogabassey-chat-anchor',
    isCartOpen && 'ogabassey-chat-anchor--hidden',
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
      ref={drag.anchorRef}
      style={drag.anchorStyle}
      className={anchorClasses}
      data-mobile-offset={mobileOffset}
      {...CHAT_MOBILE_OFFSET_ATTRIBUTES}
    >
      {/* Chat Window */}
      {isOpen && (
        <div
          className={`ogabassey-chat-window w-[calc(100vw-32px)] md:w-[400px] h-[400px] md:h-[500px] max-h-[70vh] bg-white rounded-2xl shadow-2xl border ${isSanta ? 'border-red-200' : 'border-gray-200'} overflow-hidden flex flex-col animate-in slide-in-from-bottom-5 fade-in duration-300 origin-bottom-right ring-1 ring-black/5`}
        >
          {/* Header */}
          <div
            className={`relative flex items-center justify-between p-4 border-b ${
              isSanta
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
                      Santa AI{' '}
                      <span className="text-xs ml-1">{'\u{1F384}'}</span>
                    </>
                  ) : (
                    'Ogabassey AI'
                  )}
                </h3>
                <p
                  className={`text-xs ${isSanta ? 'text-red-100' : 'text-gray-500'}`}
                >
                  Online
                </p>
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

      <ChatLauncher
        isOpen={isOpen}
        isSanta={isSanta}
        proactiveMsg={proactiveMsg}
        setProactiveMsg={setProactiveMsg}
        onClick={(event) => {
          if (!drag.suppressClick(event)) setIsOpen(!isOpen);
        }}
        drag={drag}
      />
    </div>
  );
};
