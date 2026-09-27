import type { Route } from 'next';
import { getStorefrontProductPath } from './get-storefront-product-path';
import type { StorefrontProductUrlInput } from './storefront-product-url-input';

/**
 * Lightweight product-URL helper for hot client paths (homepage product
 * grid, navbar search).
 *
 * `seo-utils.ts` re-exports this same binding, but importing it drags the
 * sanitize toolchain (`sanitize-core`, `sanitize-html`) into the early
 * client bundle. URL building needs none of that — it delegates straight
 * to the pure path helpers. The explicit-outcome tests in
 * product-url.test.ts lock the routing contract (category paths,
 * category-object routing, canonical URLs, slugless fallback).
 */
export function getProductUrl(product: StorefrontProductUrlInput): Route {
  return getStorefrontProductPath(product);
}
