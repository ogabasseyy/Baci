import type { Product } from '../../types';

export function buildCartItemId(
  productId: Product['id'],
  options?: {
    color?: string;
    secondaryColor?: string;
    condition?: string;
    storage?: string;
    variantId?: string;
    offerId?: string;
    selectedAttributes?: Record<string, string>;
  }
) {
  const parts = [String(productId)];
  if (options?.variantId) {
    parts.push(`variant=${options.variantId}`);
  }
  if (options?.color) {
    parts.push(`color=${options.color}`);
  }
  if (options?.secondaryColor) {
    parts.push(`secondaryColor=${options.secondaryColor}`);
  }
  if (options?.condition) {
    parts.push(`condition=${options.condition}`);
  }

  // Tail entries (offer id plus attribute keys) sort together so this id
  // stays byte-identical to the provider's generateCartItemId, which folds
  // every non-first-class option into one sorted extra-attribute loop.
  const tail = new Map<string, string>();
  if (options?.offerId) {
    tail.set('offerId', options.offerId);
  }
  if (options?.selectedAttributes) {
    for (const key of Object.keys(options.selectedAttributes)) {
      // Skip keys already handled explicitly above
      if (key === 'color' || key === 'condition') continue;
      const value = options.selectedAttributes[key];
      if (value) {
        tail.set(key, value);
      }
    }
  } else if (options?.storage) {
    // Fallback for callers not passing selectedAttributes
    tail.set('storage', options.storage);
  }
  for (const key of [...tail.keys()].sort()) {
    parts.push(`${key}=${tail.get(key)}`);
  }

  return parts.join('::');
}
