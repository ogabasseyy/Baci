'use client';

/** Single-component module (split from animated-nav-icons.tsx). */

import { cn } from '@/lib/utils';

/**
 * Animated Menu/Close toggle (hamburger menu)
 */
export function MenuToggle({
  isOpen = false,
  onClick,
  size = 24,
  className,
}: {
  isOpen?: boolean;
  onClick: () => void;
  size?: number;
  className?: string;
}) {
  const lineClass = 'motion-safe:transition-transform motion-safe:duration-200';
  const lineStyle = {
    transformBox: 'fill-box',
    transformOrigin: 'center',
  } as const;
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center',
        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md',
        className
      )}
      onClick={onClick}
      aria-label={isOpen ? 'Close menu' : 'Open menu'}
      aria-expanded={isOpen}
    >
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <line
          x1="3"
          y1="6"
          x2="21"
          y2="6"
          className={cn(lineClass, isOpen && 'rotate-45 translate-y-[6px]')}
          style={lineStyle}
        />
        <line
          x1="3"
          y1="12"
          x2="21"
          y2="12"
          className={cn(
            lineClass,
            'motion-safe:transition-opacity',
            isOpen && 'opacity-0 -translate-x-2.5'
          )}
          style={lineStyle}
        />
        <line
          x1="3"
          y1="18"
          x2="21"
          y2="18"
          className={cn(lineClass, isOpen && '-rotate-45 -translate-y-[6px]')}
          style={lineStyle}
        />
      </svg>
    </button>
  );
}
