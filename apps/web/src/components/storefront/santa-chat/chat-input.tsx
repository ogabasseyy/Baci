'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatMessage as ChatMessageType } from './types';

interface ChatInputProps {
  onSendMessage: (message: Omit<ChatMessageType, 'role'>) => void;
  isLoading: boolean;
}

const placeholders = [
  'Share your Christmas wish...',
  'Dear Santa...',
  'What are you dreaming of?',
  'Type your letter to Santa...',
];

/**
 * Chat input with magical placeholder animation
 * Supports text input, image upload
 */
export function ChatInput({ onSendMessage, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Keep the server/client snapshot deterministic; personalize only after
  // hydration so Math.random cannot change initial markup.
  const [placeholder, setPlaceholder] = useState(placeholders[0]);
  useEffect(() => {
    setPlaceholder(
      placeholders[Math.floor(Math.random() * placeholders.length)] ??
        placeholders[0]
    );
  }, []);

  // Auto-resize textarea when input changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: input is intentionally used to trigger resize
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage({ content: input });
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setUploadError('Please upload a JPG, PNG, GIF, or WebP image.');
      return;
    }

    // Limit file size (5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setUploadError('Image must be smaller than 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => {
      setUploadError('Failed to read file.');
    };
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        onSendMessage({ content: '', imageUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);

    // Reset input to allow re-uploading same file
    e.target.value = '';
  };

  const showSendIcon = input.trim().length > 0;

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        className={`flex items-center space-x-2 bg-white border rounded-2xl px-3 py-2 shadow-sm transition-all duration-200 ${
          showSendIcon
            ? 'border-red-600 ring-1 ring-red-600/50'
            : 'border-gray-200'
        }`}
      >
        {/* Image upload button */}
        <input
          type="file"
          ref={imageInputRef}
          onChange={handleImageUpload}
          accept="image/*"
          aria-label="Upload an image"
          className="hidden"
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="p-2 rounded-full hover:bg-gray-100 transition"
          aria-label="Upload an image"
          disabled={isLoading}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-gray-600"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Text input */}
        <div className="flex-1 relative">
          {!input && (
            <div
              className="absolute inset-0 flex items-center px-2 text-gray-400 pointer-events-none"
              aria-hidden="true"
            >
              {placeholder.split('').map((char, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: Static string mapping, order is stable
                  key={`placeholder-char-${char}-${index}`}
                  style={{
                    animation: 'magical-reveal 0.7s ease-out forwards',
                    animationDelay: `${index * 0.04}s`,
                    opacity: 0,
                  }}
                >
                  {char === ' ' ? '\u00A0' : char}
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder=""
            className="w-full outline-hidden text-gray-800 bg-transparent px-2 resize-none overflow-y-auto caret-red-600"
            style={{ maxHeight: '8rem' }}
            disabled={isLoading}
            aria-label="Type your message to Santa"
          />
        </div>

        {/* Send button */}
        {showSendIcon && (
          <button
            type="submit"
            disabled={isLoading}
            aria-label="Send message"
            className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700 transition"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
            </svg>
          </button>
        )}

        {/* CSS for magical placeholder animation */}
        <style>{`
          @keyframes magical-reveal {
            0% {
              opacity: 0;
              transform: translateX(-5px);
              text-shadow:
                0 0 10px rgba(255, 255, 255, 0.7),
                0 0 20px rgba(255, 215, 0, 0.7);
            }
            50% {
              opacity: 1;
            }
            100% {
              opacity: 1;
              transform: translateX(0);
              text-shadow: none;
            }
          }
        `}</style>
      </form>

      {/* Upload error feedback */}
      {uploadError && (
        <p role="alert" className="text-red-500 text-xs mt-1 px-3">
          {uploadError}
        </p>
      )}
    </div>
  );
}
