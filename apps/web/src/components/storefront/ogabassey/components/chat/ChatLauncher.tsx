'use client';

import { Sparkles, X } from 'lucide-react';
import type React from 'react';
import type { useChatLauncherDrag } from './use-chat-launcher-drag';

interface ChatLauncherProps {
  isOpen: boolean;
  isSanta: boolean;
  proactiveMsg: string | null;
  setProactiveMsg: (message: string | null) => void;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
  drag: ReturnType<typeof useChatLauncherDrag>;
}

export function ChatLauncher({
  isOpen,
  isSanta,
  proactiveMsg,
  setProactiveMsg,
  onClick,
  drag,
}: ChatLauncherProps) {
  const buttonClasses = [
    'ogabassey-chat-button',
    isOpen && 'ogabassey-chat-button--open',
    isSanta && 'ogabassey-chat-button--santa',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="relative group">
      {!isOpen && isSanta && (
        <div data-chat-launcher-overflow className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-32 bg-white px-4 py-3 rounded-2xl rounded-tr-none shadow-xl border-2 border-red-100 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4">
          <p className="text-sm font-bold text-gray-900 text-center leading-tight">
            Make a wish! {'\u2728'}
          </p>
          <div className="absolute -bottom-2 -right-1 size-3 bg-white rounded-full border-r border-b border-red-100" />
          <div className="absolute -bottom-4 -right-3 size-2 bg-white/90 rounded-full border border-red-50" />
        </div>
      )}

      {!isOpen && !isSanta && proactiveMsg && (
        <div data-chat-launcher-overflow className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-48 bg-white px-4 py-3 rounded-2xl rounded-tr-none shadow-lg border border-red-50 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4 z-40">
          <div className="text-gray-800 text-xs font-medium leading-relaxed">
            {proactiveMsg}
          </div>
          <div className="absolute -bottom-1.5 -right-1 size-4 bg-white rotate-45 border-r border-b border-red-50" />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setProactiveMsg(null);
            }}
            className="absolute -top-2 -left-2 bg-gray-100 hover:bg-gray-200 rounded-full p-1 transition-colors"
            aria-label="Dismiss chat message"
          >
            <X size={10} className="text-gray-500" />
          </button>
        </div>
      )}

      <button
        type="button"
        {...drag.buttonProps}
        onClick={onClick}
        className={buttonClasses}
        aria-label="Toggle chat"
        aria-expanded={isOpen}
        aria-controls={isOpen ? 'ogabassey-chat-window' : undefined}
        aria-describedby={
          isOpen ? undefined : 'ogabassey-chat-launcher-keyboard-help'
        }
        aria-keyshortcuts={
          isOpen ? undefined : 'ArrowUp ArrowDown ArrowLeft ArrowRight'
        }
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
      {!isOpen && (
        <span id="ogabassey-chat-launcher-keyboard-help" className="sr-only">
          Use arrow keys to move the assistant launcher. Hold Shift for
          48-pixel steps.
        </span>
      )}
    </div>
  );
}
