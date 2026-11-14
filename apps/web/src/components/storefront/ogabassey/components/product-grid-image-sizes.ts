/**
 * Responsive sizing ladder for the home product card image. The static
 * SSR fallback renders the same `sizes` through the same format helper as
 * HomeProductGridCard so the browser picks byte-identical JPEG candidates
 * before and after the gate swaps in the interactive card — one fetch,
 * shared cache key (the fallback is AVIF-free; swapped-in cards keep its
 * JPEG tier via matchFallbackImageTier). Change all consumers together.
 */
export const HOME_PRODUCT_GRID_CARD_IMAGE_SIZES =
  '(max-width: 480px) 40vw, (max-width: 768px) 33vw, (max-width: 1200px) 25vw, 20vw';

/**
 * Responsive sizing ladder for category catalog and listing product cards.
 * Calibrated for a 2-column mobile grid (390px viewport width -> 32vw = ~125px * 3 DPR = ~375px)
 * to select the lightweight 384w candidate instead of the oversized 640w tier on 3x DPR devices.
 */
export const STOREFRONT_PRODUCT_CARD_IMAGE_SIZES =
  '(max-width: 480px) 32vw, (max-width: 768px) 33vw, (max-width: 1200px) 25vw, 280px';

