import { createLogger } from '@/lib/logger';
import {
  hydrateProductRowsWithBaseInventory,
  hydrateProductRowsWithStorefrontVariants,
} from '@/lib/storefront-product-variants';
import { isVariantBearingProduct } from './product-variant-state';

const log = createLogger('ProductHydration');

export interface HydratableProductRow extends Record<string, unknown> {
  has_variants?: unknown;
  id?: unknown;
  variant_model?: unknown;
  variants?: unknown;
}

export function needsVariantHydration(row: HydratableProductRow): boolean {
  return isVariantBearingProduct(row);
}

export function needsBaseInventoryHydration(
  row: HydratableProductRow
): boolean {
  return !isVariantBearingProduct(row);
}

export async function hydrateRowsNeedingStorefrontVariants(
  rows: HydratableProductRow[]
): Promise<HydratableProductRow[]> {
  const rowsToHydrate = rows.filter(needsVariantHydration);
  if (rowsToHydrate.length === 0) {
    return rows;
  }

  let hydratedRows: HydratableProductRow[];
  try {
    hydratedRows =
      await hydrateProductRowsWithStorefrontVariants(rowsToHydrate);
  } catch (error) {
    log.warn('Failed to hydrate storefront variants; using original rows', {
      error,
    });
    return rows;
  }

  const hydratedById = new Map(
    hydratedRows
      .filter((row) => typeof row.id === 'string')
      .map((row) => [row.id as string, row])
  );

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    return hydratedById.get(row.id) ?? row;
  });
}

export async function hydrateRowsNeedingBaseInventory(
  rows: HydratableProductRow[]
): Promise<HydratableProductRow[]> {
  const rowsToHydrate = rows.filter(needsBaseInventoryHydration);
  if (rowsToHydrate.length === 0) {
    return rows;
  }

  let hydratedRows: HydratableProductRow[];
  try {
    hydratedRows = await hydrateProductRowsWithBaseInventory(rowsToHydrate);
  } catch (error) {
    log.warn('Failed to hydrate base inventory; using original rows', {
      error,
    });
    return rows;
  }

  const hydratedById = new Map(
    hydratedRows
      .filter((row) => typeof row.id === 'string')
      .map((row) => [row.id as string, row])
  );

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    return hydratedById.get(row.id) ?? row;
  });
}
