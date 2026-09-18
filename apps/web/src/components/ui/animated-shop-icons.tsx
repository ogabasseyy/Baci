'use client';

/** Shop icons (extracted from animated-icons): wishlist, cart, quantity. */

import { cn } from '@/lib/utils';

/**
 * Heart icon with like animation
 */
export function HeartIcon({
  liked = false,
  size = 24,
  className,
  onToggle,
}: {
  liked?: boolean;
  size?: number;
  className?: string;
  onToggle?: () => void;
}) {
  return (
    <button
      className={cn(
        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm',
        'motion-safe:transition-transform motion-safe:active:scale-[0.85]',
        className
      )}
      onClick={onToggle}
      aria-label={liked ? 'Unlike' : 'Like'}
      type="button"
    >
      <svg
        key={String(liked)}
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        className={cn(
          liked ? 'text-red-500' : 'text-muted-foreground',
          liked &&
            'motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-300'
        )}
      >
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    </button>
  );
}

/**
 * Cart icon with item count badge that animates on change
 */
export function CartIcon({
  count = 0,
  size = 24,
  className,
}: {
  count?: number;
  size?: number;
  className?: string;
}) {
  return (
    <div className="relative">
      <svg
        key={count}
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(className, count > 0 && 'motion-safe:animate-nudge-up')}
      >
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
      {count > 0 && (
        <span
          key={`badge-${count}`}
          className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:fade-in-0 motion-safe:duration-200"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </div>
  );
}

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
