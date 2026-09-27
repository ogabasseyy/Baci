import type { Product } from '../types';

/**
 * Maps a catalog condition label to the critical-CSS card badge class.
 * Pure and server-safe: shared by the interactive card and the
 * server-rendered grid fallback so both paint the same badge.
 */
export function getProductConditionClass(
  condition: Product['condition']
): string {
  const normalizedCondition = String(condition)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ');

  if (normalizedCondition === 'new') {
    return 'ogabassey-home-product-card__condition--new';
  }

  if (normalizedCondition === 'open box') {
    return 'ogabassey-home-product-card__condition--open-box';
  }

  if (normalizedCondition === 'new & used') {
    return 'ogabassey-home-product-card__condition--new-used';
  }

  return 'ogabassey-home-product-card__condition--default';
}
