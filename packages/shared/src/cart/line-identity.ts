import type { CartItemIdentity } from './types';

/**
 * Stable identity key for one cart line.
 *
 * Normalization sorts option keys so ordering never splits a line, but it
 * preserves unknown keys and values verbatim: normalization decides
 * identity, never catalog validity. The server validates values separately.
 */
export function cartLineIdentity(item: CartItemIdentity): string {
  const options = item.options ?? {};
  const sortedOptions = Object.keys(options)
    .sort()
    .map((key) => [key, options[key]] as [string, string]);

  return JSON.stringify([
    item.productId,
    item.variantId ?? null,
    item.condition ?? null,
    sortedOptions,
  ]);
}
