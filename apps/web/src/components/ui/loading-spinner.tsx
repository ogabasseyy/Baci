/** Single-component module (split from animated-feedback-icons.tsx). */

import { cn } from '@/lib/utils';

/**
 * Loading Spinner with smooth animation
 */
export function LoadingSpinner({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex motion-safe:animate-spin', className)}>
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
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </div>
  );
}
