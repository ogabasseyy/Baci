import { IMEI_CHECK_CATALOG_PART_1 } from './check-catalog-entries-1';
import { IMEI_CHECK_CATALOG_PART_2 } from './check-catalog-entries-2';
import { IMEI_CHECK_CATALOG_PART_3 } from './check-catalog-entries-3';
import { IMEI_CHECK_CATALOG_PART_4 } from './check-catalog-entries-4';
import type {
  ImeiCatalogBrand,
  ImeiCatalogDevice,
} from './check-catalog-types';
import { IMEI_SERVICE_GOALS } from './service-groups';

/** Customer outcomes, not supplier products. New entries have no invented price.
 * Entries are not added to PUBLIC_IMEI_SERVICE_TIERS or purchasable by this map.
 */
export const IMEI_CHECK_CATALOG = {
  ...IMEI_CHECK_CATALOG_PART_1,
  ...IMEI_CHECK_CATALOG_PART_2,
  ...IMEI_CHECK_CATALOG_PART_3,
  ...IMEI_CHECK_CATALOG_PART_4,
} as const;
export type ImeiCheckCatalogKey = keyof typeof IMEI_CHECK_CATALOG;

export function groupImeiCheckCatalog(
  filter: { brand?: ImeiCatalogBrand; device?: ImeiCatalogDevice } = {}
) {
  return IMEI_SERVICE_GOALS.flatMap((goal) => {
    const entries = (Object.keys(IMEI_CHECK_CATALOG) as ImeiCheckCatalogKey[])
      .filter((id) => {
        const entry = IMEI_CHECK_CATALOG[id];
        return (
          entry.goal === goal.id &&
          (!filter.brand ||
            filter.brand === 'all' ||
            entry.brands.includes('all') ||
            entry.brands.includes(filter.brand)) &&
          (!filter.device || entry.devices.includes(filter.device))
        );
      })
      .map((id) => ({ id, ...IMEI_CHECK_CATALOG[id] }));
    return entries.length ? [{ ...goal, entries }] : [];
  });
}
