'use client';

/** Single-component module (split from animated-shop-icons.tsx). */

import { cn } from '@/lib/utils';

/**
 * Animated Plus/Minus for quantity controls
 */
export function QuantityButton({
  type,
  onClick,
  disabled = false,
  className,
}: {
  type: 'plus' | 'minus';
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-foreground',
        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        'motion-safe:transition-transform motion-safe:hover:scale-105 motion-safe:active:scale-95',
        className
      )}
      onClick={onClick}
      disabled={disabled}
      aria-label={type === 'plus' ? 'Increase quantity' : 'Decrease quantity'}
    >
      <svg
        aria-hidden="true"
        width={16}
        height={16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {type === 'plus' ? (
          <>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </>
        ) : (
          <line x1="5" y1="12" x2="19" y2="12" />
        )}
      </svg>
    </button>
  );
}
