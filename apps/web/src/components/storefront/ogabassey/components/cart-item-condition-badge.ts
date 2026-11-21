import { canonicalizeCommerceVariantAxis } from '@baci/shared/lib/commerce-variant-axis';
import { formatCanonicalProductConditionLabel } from '@baci/shared/lib/product-condition';

export interface CartConditionBadgeItem {
  condition?: string;
  variantAttributes?: Record<string, string>;
}

/**
 * Resolves the display label and theme-aware badge classes for a cart line item's
 * normalized product condition.
 */
export function getCartItemConditionBadge(
  item: CartConditionBadgeItem
): { label: string; badgeClassName: string } | null {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(item.variantAttributes ?? {})) {
    const axis = canonicalizeCommerceVariantAxis(key);
    if (axis && typeof value === 'string' && value.trim()) {
      attributes[axis] = value.trim();
    }
  }
  const rawCondition =
    (typeof item.condition === 'string' ? item.condition.trim() : '') ||
    attributes.condition;
  if (!rawCondition) return null;

  const label =
    formatCanonicalProductConditionLabel(rawCondition) || rawCondition;
  const normalized = label.toLowerCase();
  const badgeClassName =
    normalized === 'new'
      ? 'bg-store-background-text text-store-background'
      : normalized === 'open box'
        ? 'bg-store-primary text-store-primary-text'
        : 'bg-store-background-text/80 text-store-background';

  return { label, badgeClassName };
}
