interface ProductImageSourceResult {
  isPlaceholder: boolean;
  src: string;
}

/**
 * Responsive sizing ladder for the home product card image. The static
 * SSR fallback renders the same `sizes` through the same format helper as
 * HomeProductGridCard so the browser picks byte-identical AVIF/jpeg
 * candidates before and after the gate swaps in the interactive card —
 * one fetch, shared cache key. Change both call sites together.
 */
export const HOME_PRODUCT_GRID_CARD_IMAGE_SIZES =
  '(max-width: 480px) 40vw, (max-width: 768px) 33vw, (max-width: 1200px) 25vw, 20vw';

export function resolveProductImageSource(
  candidates: readonly (null | string | undefined)[],
  placeholder: string
): ProductImageSourceResult {
  const source = candidates
    .map((candidate) => candidate?.trim() ?? '')
    .find((candidate) => candidate.length > 0);

  if (!source) {
    return { isPlaceholder: true, src: placeholder };
  }

  return { isPlaceholder: false, src: source };
}
