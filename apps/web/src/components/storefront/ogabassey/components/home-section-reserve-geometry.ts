import type { CSSProperties } from 'react';

/**
 * Shared geometry reserve configuration for the OgaBassey homepage
 * below-the-fold product and discovery Suspense boundaries.
 *
 * Tailwind `min-h-[...]` utility classes are written as complete unbroken
 * literals so the Tailwind scanner always emits them, while explicit inline
 * `minHeight` styles hold the footprint before the deferred
 * `storefront-home.css` stylesheet finishes loading or while Fizz swaps nested
 * Suspense fallbacks.
 */
export const OGABASSEY_HOME_SECTION_RESERVE_GEOMETRY = {
  product: {
    minHeightClass: 'min-h-[1200px]',
    style: {
      minHeight: '1200px',
    } satisfies CSSProperties,
  },
  discovery: {
    minHeightClass: 'min-h-[280px]',
    style: {
      minHeight: '280px',
    } satisfies CSSProperties,
  },
} as const;
