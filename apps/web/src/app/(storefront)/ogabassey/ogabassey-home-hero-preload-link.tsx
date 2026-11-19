import { preloadOgabasseyHomeHeroResources } from './ogabassey-home-hero-resource-hints';

/**
 * Synchronous component boundary and single preload owner for the home hero's
 * slide-0 LCP image.
 *
 * 1. Keeping this as a synchronous component rendered by `async` callers
 *    (such as `OgabasseyHomeCommittedSlideZeroPreload`) ensures `preload()`
 *    executes inside an active synchronous React Fizz `performWork` tick where
 *    `currentRequest` is bound.
 * 2. Calling `preloadOgabasseyHomeHeroResources(src)` (`react-dom` `preload()`)
 *    and returning `null` instead of rendering a literal `<link rel="preload">`
 *    JSX element avoids React 19's `react-server-dom-webpack` double-preload
 *    behavior (which both calls `preload()` for `<link rel="preload" as="image">`
 *    AND serializes the `<link>` tag into `hoistableChunks`).
 */
export function OgabasseyHomeHeroPreloadLink({
  src,
}: {
  src: string | null | undefined;
}) {
  preloadOgabasseyHomeHeroResources(src);
  return null;
}
