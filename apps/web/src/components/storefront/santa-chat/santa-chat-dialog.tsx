'use client';

import Image from 'next/image';
import { ChatInput } from './chat-input';
import { ChatMessage } from './chat-message';
import { SantaChatHeader } from './santa-chat-header';
import { stripSantaActions } from './types';
import { useSantaChat } from './use-santa-chat';
import { WelcomeScreen } from './welcome-screen';

interface SantaChatDialogProps {
  onClose?: () => void;
  isFullPage?: boolean;
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
  const {
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
  } = useSantaChat();

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
      <SantaChatHeader
        onClose={onClose}
        merchantSlug={merchantSlug}
        cartCount={cartCount}
      />

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
