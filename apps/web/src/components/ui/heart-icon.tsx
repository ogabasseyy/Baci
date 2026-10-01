'use client';

/** Single-component module (split from animated-shop-icons.tsx). */

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
