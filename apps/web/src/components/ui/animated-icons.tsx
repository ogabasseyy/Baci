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
