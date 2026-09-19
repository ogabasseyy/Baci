'use client';

/** Single-component module (split from animated-shop-icons.tsx). */

import { cn } from '@/lib/utils';

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
