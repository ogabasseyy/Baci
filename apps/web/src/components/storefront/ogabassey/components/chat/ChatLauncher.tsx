'use client';

import { Sparkles, X } from 'lucide-react';
import Image from 'next/image';

interface ChatLauncherProps {
  isOpen: boolean;
  isSanta: boolean;
  proactiveMsg: string | null;
  buttonClasses: string;
  onToggle: () => void;
  onDismissSuggestion: () => void;
}

export function ChatLauncher({ isOpen, isSanta, proactiveMsg, buttonClasses, onToggle, onDismissSuggestion }: ChatLauncherProps) {
  return (
    <div className="relative group">
      {!isOpen && isSanta ? (
        <div className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-32 bg-store-background px-4 py-3 rounded-2xl rounded-tr-none shadow-xl border-2 border-store-primary/10 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4">
          <p className="text-sm font-bold text-store-background-text text-center leading-tight">Make a wish! {'\u2728'}</p>
          <div className="absolute -bottom-2 -right-1 size-3 bg-store-background rounded-full border-r border-b border-store-primary/10" />
          <div className="absolute -bottom-4 -right-3 size-2 bg-store-background/90 rounded-full border border-store-primary/10" />
        </div>
      ) : null}
      {!isOpen && !isSanta && proactiveMsg ? (
        <div className="absolute bottom-[90%] right-[85%] mr-[-20px] mb-[-10px] w-48 bg-store-background px-4 py-3 rounded-2xl rounded-tr-none shadow-lg border border-store-primary/10 transform transition-[transform,opacity] duration-300 animate-in fade-in slide-in-from-bottom-4 z-40">
          <div className="text-store-background-text text-xs font-medium leading-relaxed">{proactiveMsg}</div>
          <div className="absolute -bottom-1.5 -right-1 size-4 bg-store-background rotate-45 border-r border-b border-store-primary/10" />
          <button type="button" onClick={onDismissSuggestion} aria-label="Dismiss chat suggestion" className="absolute -top-2 -left-2 bg-store-background-text/5 hover:bg-store-background-text/10 rounded-full p-1 transition-colors">
            <X size={10} className="text-store-background-text/70" />
          </button>
        </div>
      ) : null}
      <button type="button" onClick={onToggle} className={buttonClasses} aria-label="Toggle chat">
        {isOpen ? <X size={28} /> : isSanta ? (
          <div className="relative w-full h-full">
            <Image src="/african-santa-head.svg" alt="Santa" fill sizes="64px" className="w-full h-full object-contain drop-shadow-xl hover:brightness-110 transition-all filter" />
          </div>
        ) : (
          <>
            <Sparkles size={28} className="md:w-8 md:h-8 drop-shadow-xs" fill="currentColor" fillOpacity={0.1} />
            <span className="ogabassey-chat-badge"><span className="ogabassey-chat-badge__ping" /><span className="ogabassey-chat-badge__label">AI</span></span>
          </>
        )}
      </button>
    </div>
  );
}
