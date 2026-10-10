import { createLogger } from '@/lib/logger';
import { hydrateProductRowsWithBaseInventory } from '@/lib/storefront-product-base-inventory';
import { hydrateProductRowsWithConditionOffers } from '@/lib/storefront-product-offers';
import { hydrateProductRowsWithStorefrontVariants } from '@/lib/storefront-product-variants';
import { isVariantBearingProduct } from './product-variant-state';

const log = createLogger('ProductHydration');

export interface HydratableProductRow extends Record<string, unknown> {
  has_condition_offers?: unknown;
  has_variants?: unknown;
  id?: unknown;
  offers?: unknown;
  offers_hydration_failed?: unknown;
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

export function needsConditionOffersHydration(
  row: HydratableProductRow
): boolean {
  return row.has_condition_offers === true;
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

export async function hydrateRowsNeedingConditionOffers(
  rows: HydratableProductRow[]
): Promise<HydratableProductRow[]> {
  const rowsToHydrate = rows.filter(needsConditionOffersHydration);
  if (rowsToHydrate.length === 0) {
    return rows;
  }

  let hydratedRows: HydratableProductRow[];
  try {
    hydratedRows = await hydrateProductRowsWithConditionOffers(rowsToHydrate);
  } catch (error) {
    log.warn('Failed to hydrate condition offers; using original rows', {
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
