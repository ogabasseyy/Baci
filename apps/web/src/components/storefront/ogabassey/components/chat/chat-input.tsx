'use client';

import { Gift, Send } from 'lucide-react';
import type React from 'react';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  isSanta: boolean;
  onSubmit: (e: React.FormEvent) => void;
  privateMode?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  setInput,
  isLoading,
  isSanta,
  onSubmit,
  privateMode = false,
}) => {
  return (
    <form
      onSubmit={onSubmit}
      data-ph-no-autocapture={privateMode ? '' : undefined}
      data-ph-block={privateMode ? '' : undefined}
      data-session-replay-block={privateMode ? '' : undefined}
      aria-label={privateMode ? 'Private delivery destination entry' : undefined}
      className={`shrink-0 p-3 border-t ${isSanta ? 'bg-[#FFF5F5] border-red-100' : 'bg-store-background border-store-border'}`}
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label={privateMode ? 'Private delivery destination' : isSanta ? 'Tell Santa your wish' : 'Type your message'}
          placeholder={privateMode ? 'Describe your destination, including its state…' : isSanta ? "Tell Santa your wish..." : "Type your message..."}
          data-ph-no-autocapture={privateMode ? '' : undefined}
          data-ph-no-capture={privateMode ? '' : undefined}
          data-ph-block={privateMode ? '' : undefined}
          data-session-replay-block={privateMode ? '' : undefined}
          className={`flex-1 px-4 py-2.5 rounded-full border focus:outline-hidden focus:ring-2 focus:ring-offset-1 transition-all text-sm ${isSanta
            ? 'border-red-200 focus:border-red-400 focus:ring-red-100 bg-white placeholder:text-red-300'
            : 'border-store-border bg-store-background text-store-background-text focus:border-store-primary focus:ring-store-primary/20'
          }`}
          disabled={isLoading}
        />
        <button
          type="submit"
          aria-label={isSanta ? 'Send wish' : privateMode ? 'Check destination state' : 'Send message'}
          disabled={!input.trim() || isLoading}
          className={`p-2.5 rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm flex items-center justify-center w-10 h-10 ${isSanta
            ? 'bg-red-600 hover:bg-red-700 hover:scale-105 active:scale-95'
            : 'bg-store-primary text-store-primary-text hover:opacity-90'
          }`}
        >
          {isSanta ? <Gift size={18} /> : <Send size={18} />}
        </button>
      </div>
    </form>
  );
};
