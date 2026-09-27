'use client';
import { Check } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

export function CheckoutStepSection({
  id,
  title,
  number,
  active,
  focusOnActivate = false,
  completed,
  disabled = false,
  summary,
  onOpen,
  children,
}: {
  id: string;
  title: string;
  number: number;
  active: boolean;
  focusOnActivate?: boolean;
  completed: boolean;
  disabled?: boolean;
  summary?: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    // Move focus out of the panel that just collapsed; don't steal it on load.
    if (active && !wasActive.current && focusOnActivate)
      buttonRef.current?.focus();
    wasActive.current = active;
  }, [active, focusOnActivate]);
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border ${active ? 'border-store-primary ring-1 ring-store-primary/20' : 'border-gray-100'} transition-all duration-300`}
    >
      <h2>
        <button
          ref={buttonRef}
          id={`${id}-heading`}
          type="button"
          onClick={onOpen}
          disabled={disabled}
          aria-label={title}
          aria-describedby={
            completed && !active && summary ? `${id}-summary` : undefined
          }
          aria-expanded={active}
          aria-controls={`${id}-panel`}
          className="w-full px-6 py-4 flex items-center justify-between gap-3 text-left disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-store-primary focus-visible:ring-inset"
        >
          <span className="min-w-0">
            <span className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-6 rounded-full flex items-center justify-center text-xs ${completed ? 'bg-green-100 text-green-600' : active ? 'bg-store-primary/10 text-store-primary' : 'bg-gray-100 text-gray-500'}`}
              >
                {completed ? <Check size={14} /> : number}
              </span>
              {title}
            </span>
            {completed && !active && summary && (
              <span
                id={`${id}-summary`}
                className="block mt-1 pl-8 text-xs font-normal text-gray-500 truncate"
              >
                {summary}
              </span>
            )}
          </span>
          {completed && !active && (
            <span className="text-sm font-semibold text-store-primary underline-offset-4 hover:underline shrink-0">
              Edit
            </span>
          )}
        </button>
      </h2>
      <section
        id={`${id}-panel`}
        aria-labelledby={`${id}-heading`}
        hidden={!active}
        inert={!active}
      >
        <div className="p-6 pt-0 space-y-4">{children}</div>
      </section>
    </div>
  );
}
