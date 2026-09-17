'use client';

/**
 * Animated Icons using CSS transitions/animations (no animation runtime).
 *
 * Micro-interactions are transform/opacity-only so they never cause layout
 * shift. Every animation class is `motion-safe:`-gated to preserve the
 * previous prefers-reduced-motion behavior (base state is the visible
 * end-state, so reduced-motion users snap instead of animating).
 */

import type { ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedIconWrapperProps {
  children: ReactNode;
  animation?: 'spin' | 'pulse' | 'bounce' | 'shake' | 'none';
  hoverEffect?: 'scale' | 'rotate' | 'none';
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

const ANIMATION_CLASSES: Record<
  NonNullable<AnimatedIconWrapperProps['animation']>,
  string
> = {
  // Tailwind built-ins match the old loop cadences (spin 1s linear,
  // pulse 1.5s, bounce default); shake is a theme keyframe below.
  spin: 'motion-safe:animate-spin',
  pulse: 'motion-safe:animate-pulse',
  bounce: 'motion-safe:animate-bounce',
  shake: 'motion-safe:animate-shake',
  none: '',
};

const HOVER_CLASSES: Record<
  NonNullable<AnimatedIconWrapperProps['hoverEffect']>,
  string
> = {
  scale:
    'motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-[1.15] motion-safe:active:scale-95',
  rotate:
    'motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:rotate-12 motion-safe:active:-rotate-12',
  none: '',
};

/**
 * Animated Icon Wrapper
 * Wraps any icon with animation effects
 */
export const AnimatedIcon = ({
  ref,
  children,
  animation = 'none',
  hoverEffect = 'scale',
  className,
  onClick,
  ariaLabel,
}: AnimatedIconWrapperProps & { ref?: Ref<HTMLDivElement> }) => {
  const interactiveClass = onClick
    ? 'cursor-pointer bg-transparent border-0 p-0'
    : undefined;
  if (onClick) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        className={cn(
          'inline-flex items-center justify-center',
          ANIMATION_CLASSES[animation],
          HOVER_CLASSES[hoverEffect],
          interactiveClass,
          className
        )}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  }
  // Note: aria-label is button-only — a static div ignores it in AT, and
  // role-less labeled divs fail useAriaPropsSupportedByRole.
  void ariaLabel;
  return (
    <div
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center',
        ANIMATION_CLASSES[animation],
        HOVER_CLASSES[hoverEffect],
        className
      )}
    >
      {children}
    </div>
  );
};
AnimatedIcon.displayName = 'AnimatedIcon';

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
