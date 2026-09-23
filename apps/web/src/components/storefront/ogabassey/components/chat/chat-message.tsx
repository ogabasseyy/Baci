'use client';

import { Gift, ShoppingCart, Sparkles, User } from 'lucide-react';
import type React from 'react';
import { AgentUiEventRenderer } from './agent-ui-event-renderer';
import type { ChatMessage } from './types';
import { renderMarkdown } from './markdown-renderer';

const SantaIcon: React.FC<{ className?: string }> = ({ className }) => (
  <div
    className={`${className} bg-red-600 rounded-full flex items-center justify-center text-white font-bold text-xs border-2 border-white shadow-sm`}
  >
    {'\u{1F385}'}
  </div>
);

interface ChatMessageBubbleProps {
  message: ChatMessage;
  index: number;
  isSanta: boolean;
  onAddToCart: (messageIndex: number, actionIndex?: number) => void;
}

const SANTA_PRICE_FORMATTER_INTEGER = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  maximumFractionDigits: 0,
  style: 'currency',
});
const SANTA_PRICE_FORMATTER_DECIMAL = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  maximumFractionDigits: 2,
  style: 'currency',
});

function formatSantaPrice(price: number): string {
  const formatter = Number.isInteger(price)
    ? SANTA_PRICE_FORMATTER_INTEGER
    : SANTA_PRICE_FORMATTER_DECIMAL;
  return formatter.format(price);
}

export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({
  message,
  index,
  isSanta,
  onAddToCart,
}) => {
  const santaActions =
    message.santaActions ?? (message.santaAction ? [message.santaAction] : []);

  return (
    <div
      className={`flex items-end gap-2 group ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${message.role === 'user' ? 'bg-gray-200 text-gray-600 hidden' : 'bg-white border border-gray-100 text-red-600'}`}
      >
        {message.role === 'user' ? (
          <User size={14} className="text-red-600" />
        ) : isSanta ? (
          <SantaIcon className="size-6" />
        ) : (
          <Sparkles size={14} />
        )}
      </div>

      {/* Bubble */}
      <div className="flex flex-col gap-1 max-w-[85%]">
        <span
          className={`text-[10px] text-gray-400 px-1 ${message.role === 'user' ? 'text-right' : 'text-left'}`}
        >
          {message.role === 'user' ? 'You' : isSanta ? 'Santa AI' : 'Ogabassey AI'}
        </span>
        <div
          className={`px-4 py-3 rounded-2xl text-[14px] leading-relaxed shadow-sm whitespace-pre-wrap ${message.role === 'user'
            ? 'bg-red-600 text-white rounded-tr-none shadow-red-100'
            : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
          }`}
        >
          {renderMarkdown(message.text)}

          {message.role === 'model' && message.uiEvents && (
            <AgentUiEventRenderer events={message.uiEvents} />
          )}

          {/* Santa Wish Granted - Add to Cart Button */}
          {santaActions.length > 0 && (
            <div
              aria-label="Santa wish granted actions"
              className="mt-3 pt-3 border-t border-[color:color-mix(in_srgb,var(--store-primary)_24%,transparent)]"
              role="region"
            >
              <div className="flex items-center gap-2 mb-2">
                <Gift size={16} className="text-[var(--store-primary)]" />
                <span className="text-xs font-semibold text-[var(--store-primary)]">
                  Wish Granted!
                </span>
              </div>
              {santaActions.map((santaAction, actionIndex) => (
                <div
                  key={`${santaAction.productName}-${santaAction.price}-${actionIndex}`}
                  className="mb-3 last:mb-0"
                >
                  <div className="text-sm text-[var(--store-text-muted,#4b5563)] mb-2">
                    <span className="font-medium">{santaAction.productName}</span>
                    <br />
                    <span className="text-[var(--store-primary)] font-bold">
                      {formatSantaPrice(santaAction.price)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddToCart(index, actionIndex)}
                    disabled={santaAction.added}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${santaAction.added
                      ? 'bg-[color:color-mix(in_srgb,var(--store-primary)_12%,transparent)] text-[var(--store-primary)] cursor-default'
                      : 'bg-[var(--store-primary)] text-[var(--store-primary-foreground,#fff)] hover:brightness-95 hover:scale-[1.02] active:scale-[0.98]'
                    }`}
                  >
                    <ShoppingCart size={16} />
                    {santaAction.added ? 'Added to Cart!' : 'Add to Cart & Checkout'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
