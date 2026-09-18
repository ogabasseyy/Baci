/** Feedback icons (extracted from animated-icons): loading, success, notification. */

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

/**
 * Success Checkmark with draw animation
 * (CSS fade+scale approximates the previous SVG path draw.)
 */
export function SuccessCheck({
  size = 24,
  className,
  delay = 0,
}: {
  size?: number;
  className?: string;
  delay?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn(
        'text-green-500 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300',
        className
      )}
      style={delay > 0 ? { animationDelay: `${delay}s` } : undefined}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Notification Bell with shake animation on new notification
 */
export function NotificationBell({
  hasNotification = false,
  size = 24,
  className,
}: {
  hasNotification?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <div className="relative">
      <div
        key={String(hasNotification)}
        className={cn(
          className,
          hasNotification && 'motion-safe:animate-wiggle'
        )}
      >
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
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </div>
      {hasNotification && (
        <span className="absolute -top-1 -right-1 size-3 rounded-full bg-red-500 motion-safe:animate-in motion-safe:zoom-in-0 motion-safe:fade-in-0 motion-safe:duration-200" />
      )}
    </div>
  );
}
