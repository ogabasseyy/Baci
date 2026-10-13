/** Single-component module (split from animated-feedback-icons.tsx). */

import { cn } from '@/lib/utils';

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
