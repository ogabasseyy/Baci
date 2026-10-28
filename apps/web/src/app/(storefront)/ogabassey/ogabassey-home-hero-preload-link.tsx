import { preloadOgabasseyHomeHeroResources } from './ogabassey-home-hero-resource-hints';

/**
 * Single preload owner for the home hero's slide-0 LCP image.
 *
 * Delegates directly to `preloadOgabasseyHomeHeroResources(src)` (`react-dom`
 * `preload()`) instead of rendering a literal `<link rel="preload">` JSX node:
 * in React 19 + Next.js App Router, a Server Component `<link rel="preload">`
 * both triggers an automatic `:HL` `preload()` hint AND hoists a literal
 * `<link>` into `<head>`, producing two duplicate `<link rel="preload"
 * as="image">` tags in the SSR HTML document. Calling `preload()` once emits
 * a single scanner-visible `<link rel="preload" as="image">` at the top of
 * `<head>` with attributes derived from `getOgabasseyHeroLcpImage`.
 */
export function OgabasseyHomeHeroPreloadLink({
  src,
}: {
  src: string | null | undefined;
}) {
  preloadOgabasseyHomeHeroResources(src);
  return null;
}
