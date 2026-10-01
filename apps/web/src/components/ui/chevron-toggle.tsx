'use client';

/** Single-component module (split from animated-nav-icons.tsx). */

import { cn } from '@/lib/utils';

/**
 * Animated chevron for accordions/expandable sections
 */
export function ChevronToggle({
  isExpanded = false,
  size = 20,
  className,
}: {
  isExpanded?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-in-out',
        isExpanded && 'rotate-180',
        className
      )}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
