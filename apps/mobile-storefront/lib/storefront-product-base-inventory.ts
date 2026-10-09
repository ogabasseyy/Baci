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
    return rows;
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
