import type { CSSProperties } from 'react';

/**
 * Shared geometry reserve constants for the OgaBassey homepage below-the-fold
 * product and discovery Suspense boundaries.
 *
 * Both the Tailwind `min-h-[...]` utility class and the explicit inline
 * `minHeight` style are derived from the same pixel constant so the reserve
 * holds its footprint even before the deferred `storefront-home.css`
 * stylesheet finishes loading or while Fizz swaps nested Suspense fallbacks.
 */

export const OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_PX = '1200px';

export const OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_CLASS = `min-h-[${OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_PX}]`;

export const OGABASSEY_HOME_PRODUCT_RESERVE_STYLE = {
  minHeight: OGABASSEY_HOME_PRODUCT_RESERVE_MIN_HEIGHT_PX,
} satisfies CSSProperties;

export const OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_PX = '280px';

export const OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_CLASS = `min-h-[${OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_PX}]`;

export const OGABASSEY_HOME_DISCOVERY_RESERVE_STYLE = {
  minHeight: OGABASSEY_HOME_DISCOVERY_RESERVE_MIN_HEIGHT_PX,
} satisfies CSSProperties;
