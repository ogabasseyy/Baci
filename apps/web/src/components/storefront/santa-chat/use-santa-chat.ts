'use client';

import { isSantaGrantedPriceWithinCeiling } from '@baci/shared/lib';
import { useEffect, useRef, useState } from 'react';
import { SANTA_GREETING } from '@/ai/prompts/santa';
import { findMergingCartLineIndex } from '@/hooks/cart/find-merging-cart-line';
import { getMerchantCartState } from '@/hooks/cart/merchant-cart-storage';
import { useCart } from '@/hooks/use-cart';
import type { Product } from '@/lib/products';
import { readSantaMerchantSlug } from './read-santa-merchant-slug';
import {
  type SantaDialogMessage,
  streamSantaReply,
} from './stream-santa-reply';
import type { ChatMessage as ChatMessageType } from './types';

/**
 * Owns Santa dialog orchestration: streaming replies, server-attested
 * tenant adoption, and tenant-scoped cart wishes. The dialog component
 * renders from this state.
 */
export function useSantaChat() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [messages, setMessages] = useState<SantaDialogMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartNotification, setCartNotification] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const processedActionsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Cart integration
  const { addToCart, cartCount, applyNegotiatedPrice, setMerchantSlug } =
    useCart();

  // Server-attested tenant, adopted from Santa response headers. Nothing is
  // assumed on mount: cart actions wait for the first attested reply.
  const [merchantSlug, setResolvedMerchantSlug] = useState<string | null>(null);

  // Cleanup abort/timers on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (notificationTimerRef.current)
        clearTimeout(notificationTimerRef.current);
    };
  }, []);

  const handleMerchantSlug = (slug: string) => {
    setResolvedMerchantSlug(slug);
    setMerchantSlug(slug);
  };

  const showNotification = (msg: string) => {
    if (notificationTimerRef.current)
      clearTimeout(notificationTimerRef.current);
    setCartNotification(msg);
    notificationTimerRef.current = setTimeout(
      () => setCartNotification(null),
      3000
    );
  };

  /**
   * Fetch product by name and add to cart with negotiated price.
   *
   * The wish is only fulfillable against the tenant that attested the reply
   * it came from — the reply slug is threaded through from the stream
   * response because the `merchantSlug` state closure is stale on the first
   * turn (still null when the reply adopts the tenant) and lags by a render
   * whenever the reply tenant changes.
   */
  const handleAddToCart = async (
    productName: string,
    negotiatedPrice: number,
    replyMerchantSlug: string | null
  ) => {
    if (!replyMerchantSlug) {
      console.error('[Santa Cart] Missing resolved merchant slug');
      return;
    }
    try {
      const response = await fetch('/api/chat/santa/product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-baci-storefront-slug': replyMerchantSlug,
        },
        body: JSON.stringify({ name: productName }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        console.error('[Santa Cart] Failed to fetch product');
        return;
      }

      const resolvedMerchantSlug = readSantaMerchantSlug(response);
      if (resolvedMerchantSlug !== replyMerchantSlug) {
        console.error('[Santa Cart] Resolved tenant differs from storefront', {
          expectedMerchantSlug: replyMerchantSlug,
          resolvedMerchantSlug,
        });
        showNotification(
          'Open the resolved storefront before adding this wish'
        );
        return;
      }

      handleMerchantSlug(resolvedMerchantSlug);

      const { product } = (await response.json()) as {
        product: (Product & { max_discount_percentage?: number }) | null;
      };

      if (!product) {
        console.error('[Santa Cart] Product not found:', productName);
        showNotification(`Could not find "${productName}" in catalog`);
        return;
      }
      if (product.manage_stock && (product.stock ?? 0) <= 0) {
        showNotification(`"${productName}" is out of stock`);
        return;
      }

      // addToCart merges into an existing line for the same product, and the
      // negotiated unit price would then reprice previously added units too.
      // Only negotiate fresh lines so the grant covers exactly the added unit.
      // Existence uses the shared merge matcher against the adopted
      // merchant's saved cart — the exact cart setMerchantSlug loaded above
      // and addToCart merges into — never the hook's `cart` snapshot, which
      // still holds the pre-switch cart.
      const lineAlreadyExists =
        findMergingCartLineIndex(
          getMerchantCartState(resolvedMerchantSlug).cart,
          product
        ) >= 0;
      addToCart(product, 1);

      const cartItemId = product.id;
      if (
        applyNegotiatedPrice &&
        !lineAlreadyExists &&
        negotiatedPrice < product.price &&
        isSantaGrantedPriceWithinCeiling(
          product.price,
          negotiatedPrice,
          product.max_discount_percentage ?? 0
        )
      ) {
        applyNegotiatedPrice(cartItemId, negotiatedPrice);
      }

      showNotification(`${product.name} added to cart!`);
    } catch (err) {
      console.error('[Santa Cart] Error adding to cart:', err);
    }
  };

  // Scroll to bottom on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: Intentionally trigger scroll when messages array changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleStartChat = () => {
    setShowWelcome(false);
    // Add Santa's greeting
    setMessages([
      {
        id: 'greeting',
        role: 'assistant',
        content: SANTA_GREETING,
      },
    ]);
  };

  const sendMessage = (userMessage: string, imageUrl?: string) => {
    if (!userMessage.trim() && !imageUrl) return;

    const userMsg: SantaDialogMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
      imageUrl,
    };

    // Add user message to state
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsLoading(true);
    setError(null);

    streamSantaReply({
      updatedMessages,
      abortControllerRef,
      processedActionsRef,
      setMessages,
      onCartAction: handleAddToCart,
      expectedMerchantSlug: merchantSlug,
      onMerchantSlug: handleMerchantSlug,
    })
      .catch((err) => {
        console.error('Santa chat error:', err);
        setError(
          "Oh dear, my elves are telling me there's a bit of a snowstorm interfering with our connection."
        );
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const handleSendMessage = (message: Omit<ChatMessageType, 'role'>) => {
    sendMessage(message.content, message.imageUrl);
  };

  return {
    cartCount,
    cartNotification,
    error,
    handleSendMessage,
    handleStartChat,
    isLoading,
    merchantSlug,
    messages,
    messagesEndRef,
    showWelcome,
  };
}
