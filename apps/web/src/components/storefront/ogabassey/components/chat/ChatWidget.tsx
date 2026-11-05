'use client';
import '@/app/(storefront)/storefront-chat.css';
import { ShoppingCart, Sparkles, X } from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type FC } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant';
import { useV2Theme } from '../../providers/v2-theme-context';
import { useOgabasseyScrollVisibility } from '../../scroll-visibility-store';
import { ChatInput } from './chat-input';
import { ChatLauncher } from './ChatLauncher';
import { ChatCartReview } from './chat-cart-review';
import { getPrivateDeliveryEstimateUrl } from './chat-delivery-estimate-url';
import { ChatDeliveryQuote } from './chat-delivery-quote';
import { ChatMessageBubble } from './chat-message';
import { useChatOpenOnMount } from './use-chat-open-on-mount';
import { useOgabasseyChat } from './use-ogabassey-chat';
import { canOfferPrivateDeliveryEstimate, getChatPanelMobileHeightCap, usePrivateDeliveryMode } from './use-private-delivery-mode';
export interface ChatWidgetProps {
  openOnMount?: boolean;
}
const CHAT_MOBILE_OFFSET_ATTRIBUTES = {
  'data-mobile-offset-cart': '6.75rem',
  'data-mobile-offset-default': '1rem',
  'data-mobile-offset-product': '1rem',
  'data-mobile-offset-screen': '1rem',
} as const;
export const ChatWidget: FC<ChatWidgetProps> = ({
  openOnMount = false,
}) => {
  const {
    isCartOpen,
    cart = [],
    subtotal = 0,
    isHydrated = false,
    sharedCartRef,
    merchantSlug: cartMerchantSlug,
  } = useCart();
  const { theme } = useV2Theme();
  const pathname = usePathname();
  const merchant = useMerchantSafe();
  const isFooterVisible = useOgabasseyScrollVisibility();
  const isSanta = theme === 'santa';
  const privateDelivery = usePrivateDeliveryMode();
  const deliveryEstimateUrl = getPrivateDeliveryEstimateUrl(merchant?.routingMode, merchant?.merchant?.slug);
  const [cartPanelOpen, setCartPanelOpen] = useState(false);
  const cartKey = JSON.stringify([cart.map((item) => [item.cartItemId, item.quantity, item.price, item.negotiatedPrice]), subtotal, sharedCartRef?.version, merchant?.merchant?.id, merchant?.merchant?.slug, merchant?.merchant?.country, merchant?.merchant?.payout_currency, merchant?.routingMode, cartMerchantSlug]);
  const canOfferDeliveryEstimate = canOfferPrivateDeliveryEstimate({ hydrated: isHydrated, hasItems: cart.length > 0, routingMode: merchant?.routingMode, merchantSlug: merchant?.merchant?.slug, cartMerchantSlug, country: merchant?.merchant?.country, payoutCurrency: merchant?.merchant?.payout_currency });

  const cartItemCount = cart.reduce((count, item) => count + item.quantity, 0);

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

  useEffect(() => { if (privateDelivery.active && (!deliveryEstimateUrl || !canOfferDeliveryEstimate)) privateDelivery.close(() => setInput('')); }, [canOfferDeliveryEstimate, deliveryEstimateUrl, privateDelivery, setInput]);

  useEffect(() => {
    if (cartPanelOpen || privateDelivery.active) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [cartPanelOpen, privateDelivery.active, messagesEndRef]);
  const closeChat = () => {
    setCartPanelOpen(false);
    if (privateDelivery.active) privateDelivery.close(() => setInput(''));
    setIsOpen(false);
  };

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
  const mobileBottomOffset = mobileOffset === 'cart' ? '6.75rem' : '1rem';
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
          className={`w-[calc(100vw-32px)] md:w-[400px] h-auto min-h-[min(400px,var(--chat-mobile-height-cap))] max-h-[var(--chat-mobile-height-cap)] md:min-h-[min(420px,80vh)] md:max-h-[min(80vh,720px)] bg-store-background rounded-2xl shadow-2xl border ${isSanta ? 'border-store-primary/20' : 'border-store-border'} overflow-hidden flex flex-col animate-in slide-in-from-bottom-5 fade-in duration-300 origin-bottom-right ring-1 ring-store-background-text/5`}
          style={{ '--chat-mobile-height-cap': getChatPanelMobileHeightCap(mobileBottomOffset) } as CSSProperties}
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
                <Image
                  src="/african-santa-head.svg"
                  alt="Santa"
                  width={36}
                  height={36}
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
            <div className="relative z-10 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCartPanelOpen((open) => !open)}
                className={`relative min-h-10 min-w-10 rounded-full ${isSanta ? 'hover:bg-store-primary/80' : 'hover:bg-store-background-text/5'} transition-colors inline-flex items-center justify-center`}
                aria-label={`Cart, ${cartItemCount} ${cartItemCount === 1 ? 'item' : 'items'}`}
                aria-expanded={cartPanelOpen}
                aria-controls="chat-cart-panel"
                title="Toggle cart"
              >
                <ShoppingCart size={19} aria-hidden="true" />
                {cartItemCount > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-store-primary text-[10px] font-semibold text-store-background">
                    {cartItemCount > 9 ? '9+' : cartItemCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={closeChat}
                className={`min-h-10 min-w-10 rounded-full ${isSanta ? 'hover:bg-store-primary/80' : 'hover:bg-store-background-text/5'} transition-colors inline-flex items-center justify-center`}
                aria-label="Close chat"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div
            className={`min-h-0 flex-1 overflow-y-auto p-4 scroll-smooth relative ${isSanta ? 'bg-store-primary/5' : 'bg-store-background'}`}
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
                        className={`w-1.5 h-1.5 rounded-full animate-bounce ${isSanta ? 'bg-store-primary/60' : 'bg-store-background-text/40'}`}
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full animate-bounce ${isSanta ? 'bg-store-primary/60' : 'bg-store-background-text/40'}`}
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className={`w-1.5 h-1.5 rounded-full animate-bounce ${isSanta ? 'bg-store-primary/60' : 'bg-store-background-text/40'}`}
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div id="chat-cart-panel" hidden={!cartPanelOpen}>
                {cartPanelOpen ? (
                  <ChatCartReview onRequestDeliveryQuote={
                    canOfferDeliveryEstimate
                      ? () => {
                          setInput('');
                          setCartPanelOpen(false);
                          privateDelivery.start();
                        }
                      : undefined
                  } />
                ) : null}
              </div>

              {privateDelivery.active && deliveryEstimateUrl && canOfferDeliveryEstimate ? (
                <ChatDeliveryQuote
                  estimateUrl={deliveryEstimateUrl}
                  cartKey={cartKey}
                  input={input}
                  setInput={setInput}
                  submitRef={privateDelivery.submitRef}
                  onComposerLockChange={privateDelivery.setComposerLocked}
                  onClose={() => privateDelivery.close(() => setInput(''))}
                />
              ) : null}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <ChatInput
            input={input}
            setInput={setInput}
            isLoading={isLoading || privateDelivery.composerLocked}
            isSanta={isSanta}
            onSubmit={(event) => privateDelivery.handleComposerSubmit(event, handleSubmit)}
            privateMode={privateDelivery.active}
          />
        </div>
      )}

      <ChatLauncher
        isOpen={isOpen}
        isSanta={isSanta}
        proactiveMsg={proactiveMsg}
        buttonClasses={buttonClasses}
        onToggle={() => (isOpen ? closeChat() : setIsOpen(true))}
        onDismissSuggestion={() => setProactiveMsg(null)}
      />
    </div>
  );
};
