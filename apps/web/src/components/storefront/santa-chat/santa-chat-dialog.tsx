'use client';

import { isSantaGrantedPriceWithinCeiling } from '@baci/shared/lib';
import Image from 'next/image';
import Link from 'next/link';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { SANTA_GREETING } from '@/ai/prompts/santa';
import { useCart } from '@/hooks/use-cart';
import type { Product } from '@/lib/products';
import { ChatInput } from './chat-input';
import { ChatMessage } from './chat-message';
import type { ChatMessage as ChatMessageType } from './types';
import { parseSantaActions, stripSantaActions } from './types';
import { WelcomeScreen } from './welcome-screen';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
}

interface SantaChatDialogProps {
  onClose?: () => void;
  isFullPage?: boolean;
}

interface StreamSantaReplyOptions {
  updatedMessages: Message[];
  abortControllerRef: { current: AbortController | null };
  processedActionsRef: { current: Set<string> };
  setMessages: Dispatch<SetStateAction<Message[]>>;
  onCartAction: (productName: string, price: number) => Promise<void>;
}

// Module-scope helper: keeps throw-in-try out of the component body so
// React Compiler can memoize SantaChatDialog.
async function streamSantaReply({
  updatedMessages,
  abortControllerRef,
  processedActionsRef,
  setMessages,
  onCartAction,
}: StreamSantaReplyOptions): Promise<void> {
  // Cancel any previous in-flight request
  abortControllerRef.current?.abort();
  const controller = new AbortController();
  abortControllerRef.current = controller;

  const response = await fetch('/api/chat/santa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      messages: updatedMessages.map((m) => ({
        role: m.role,
        content: m.content,
        imageUrl: m.imageUrl,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to get response from Santa');
  }

  // Handle streaming response
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let assistantContent = '';
  const assistantId = `assistant-${Date.now()}`;

  // Add empty assistant message
  setMessages((prev) => [
    ...prev,
    { id: assistantId, role: 'assistant', content: '' },
  ]);

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // toTextStreamResponse() returns raw UTF-8 text chunks
      assistantContent += chunk;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: assistantContent } : m
        )
      );
    }

    // After streaming completes, check for cart actions. Process every
    // directive once so display stripping cannot hide unfulfilled wishes.
    const actions = parseSantaActions(assistantContent);
    if (actions.length > 0 && !processedActionsRef.current.has(assistantId)) {
      processedActionsRef.current.add(assistantId);
      const actionResults = await Promise.allSettled(
        actions.map((action) => onCartAction(action.productName, action.price))
      );

      actionResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          const action = actions[index];
          console.error('[Santa Cart] Action failed:', {
            productName: action?.productName,
            price: action?.price,
            reason: result.reason,
          });
        }
      });
    }
  }
}

/**
 * Main Santa Chat Dialog
 *
 * Uses manual fetch to the streaming API endpoint.
 * Can be used as a full-page experience or inside a modal/widget.
 */
export function SantaChatDialog({
  onClose,
  isFullPage = false,
}: SantaChatDialogProps) {
  const [showWelcome, setShowWelcome] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
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
  const { addToCart, cart, cartCount, applyNegotiatedPrice, setMerchantSlug } =
    useCart();

  // Set merchant slug on mount + cleanup abort/timers on unmount
  useEffect(() => {
    setMerchantSlug('ogabassey');
    return () => {
      abortControllerRef.current?.abort();
      if (notificationTimerRef.current)
        clearTimeout(notificationTimerRef.current);
    };
  }, [setMerchantSlug]);

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
   * Fetch product by name and add to cart with negotiated price
   */
  const handleAddToCart = async (
    productName: string,
    negotiatedPrice: number
  ) => {
    try {
      const response = await fetch('/api/chat/santa/product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: productName }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        console.error('[Santa Cart] Failed to fetch product');
        return;
      }

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
      const lineAlreadyExists = cart.some(
        (item) => item.cartItemId === product.id
      );
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

    const userMsg: Message = {
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

  if (showWelcome) {
    return (
      <div
        className={`${isFullPage ? 'h-screen w-screen' : 'h-full w-full rounded-2xl overflow-hidden'}`}
      >
        <WelcomeScreen onStart={handleStartChat} />
      </div>
    );
  }

  const containerClasses = isFullPage
    ? 'flex flex-col h-dvh bg-gray-50'
    : 'flex flex-col h-full bg-gray-50 md:rounded-2xl overflow-hidden';

  return (
    <div className={containerClasses}>
      {/* Header */}
      <header
        className="bg-red-600 p-4 text-white shadow-lg sticky top-0 z-10 flex items-center justify-between"
        style={{
          borderBottom: '4px solid #a4171d',
        }}
      >
        {/* Left: Back/Close button */}
        <div className="w-16">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close chat"
              className="p-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
                className="size-6"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Title */}
        <div className="text-center">
          <h1
            className="text-2xl md:text-3xl tracking-wider"
            style={{
              fontFamily: '"Mountains of Christmas", cursive',
              textShadow: '0 1px 3px rgba(0,0,0,0.4)',
            }}
          >
            Santa&apos;s Workshop
          </h1>
          <p
            className="text-xs text-red-100"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}
          >
            by Ogabassey
          </p>
        </div>

        {/* Right: Cart icon with count */}
        <div className="w-16 flex items-center justify-end gap-2">
          <Link
            href="/ogabassey/cart"
            className="p-2 relative"
            aria-label={`View Cart (${cartCount} items)`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-6"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M7.5 6v.75H5.513c-.96 0-1.763.746-1.858 1.705L3.11 18.238A3 3 0 0 0 6.077 21h11.846a3 3 0 0 0 2.967-2.762l-.545-9.783A1.875 1.875 0 0 0 18.487 6.75H16.5V6a4.5 4.5 0 0 0-9 0Zm1.5 0V6a3 3 0 0 1 6 0v.75H9Z"
                clipRule="evenodd"
              />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs font-bold rounded-full size-5 flex items-center justify-center">
                {cartCount > 9 ? '9+' : cartCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* Cart notification toast */}
      {cartNotification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="size-5"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm font-medium">{cartNotification}</span>
          </div>
        </div>
      )}

      {/* Messages area */}
      <main className="flex-1 overflow-y-auto p-4 md:px-6">
        <div className="max-w-3xl mx-auto">
          {messages.map((msg) => {
            // Strip ACTION commands from displayed content
            const displayContent = stripSantaActions(msg.content);
            return (
              <ChatMessage
                key={msg.id}
                message={{
                  role: msg.role,
                  content: displayContent,
                }}
              />
            );
          })}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-start my-2">
              <div className="flex gap-2 items-center">
                <Image
                  src="/african-santa-head.svg"
                  alt="Santa"
                  width={40}
                  height={40}
                  sizes="40px"
                  className="rounded-full object-cover"
                />
                <div
                  className="bg-red-100 p-3 rounded-t-xl rounded-br-xl shadow-md flex items-center"
                  style={{ minWidth: '4rem', height: '2.75rem' }}
                >
                  <div className="flex gap-2 items-center justify-center w-full text-2xl">
                    <span className="animate-pulse">✨</span>
                    <span className="animate-pulse delay-100">✨</span>
                    <span className="animate-pulse delay-200">✨</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="text-center text-red-500 my-4">{error}</div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input area */}
      <footer className="bg-white p-2 md:p-4 border-t sticky bottom-0">
        <div className="max-w-3xl mx-auto">
          <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
        </div>
      </footer>
    </div>
  );
}
