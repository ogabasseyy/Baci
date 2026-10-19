import { getStorefrontProductBaseInventoryByProductIds } from './fetch-storefront-product-base-inventory';
import type { ProductRowWithId } from './storefront-product-variants';

export async function hydrateProductRowsWithBaseInventory<
  TRow extends ProductRowWithId,
>(rows: TRow[]) {
  const inventoryByProductId =
    await getStorefrontProductBaseInventoryByProductIds(
      rows
        .map((row) => row.id)
        .filter((id): id is string => typeof id === 'string')
    );

  if (inventoryByProductId === null) {
    // RPC error results must carry the same marker as thrown failures:
    // unmarked rows fall through to the raw stock_quantity fallback and
    // render purchasable/out-of-stock with no retry state. Only rows
    // with a usable id were attempted.
    return rows.map((row) =>
      typeof row.id === 'string'
        ? { ...row, base_inventory_hydration_failed: true }
        : row
    );
  }

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    const inventory = inventoryByProductId[row.id];
    if (!inventory) {
      return row;
    }

    return {
      ...row,
      base_effective_policy: inventory.effective_policy,
      base_available_units: inventory.available_units,
    };
  });
}
