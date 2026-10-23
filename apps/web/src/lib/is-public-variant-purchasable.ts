import { resolveVariantInventory } from './resolve-variant-inventory';

/** Evaluate hydrated public units before applying the parent stock policy. */
export function isPublicVariantPurchasable(
  parent: {
    manage_stock?: boolean | null;
    stock?: number | null;
    stock_quantity?: number | null;
  },
  variant: {
    inventory_tracking_policy?: string | null;
    effective_policy?: string | null;
    available_units?: number | null;
    stock_quantity?: number | null;
  }
): boolean {
  return resolveVariantInventory(parent, variant).purchasable;
}
