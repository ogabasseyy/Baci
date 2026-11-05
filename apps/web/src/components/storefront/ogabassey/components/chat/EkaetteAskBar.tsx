'use client';

import { ArrowUp } from 'lucide-react';
import type { FormEvent } from 'react';

interface EkaetteAskBarProps {
  value: string;
  isLoading?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function EkaetteAskBar({
  value,
  isLoading = false,
  error,
  onChange,
  onSubmit,
}: EkaetteAskBarProps) {
  return (
    <div className="ogabassey-chat-ask-container">
      <form className="ogabassey-chat-ask" onSubmit={onSubmit}>
        <input
          aria-label="Ask Ekaette"
          autoComplete="off"
          disabled={isLoading}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Ask Ekaette anything…"
          value={value}
        />
        <button
          aria-label="Send question to Ekaette"
          disabled={!value.trim() || isLoading}
          type="submit"
        >
          <ArrowUp aria-hidden="true" size={20} />
        </button>
      </form>
      {error && (
        <p className="ogabassey-chat-ask-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
