import 'server-only';
import {
  groupImeiCheckCatalog,
  IMEI_CHECK_CATALOG,
  IMEI_SERVICE_TIERS,
  type ImeiCatalogBrand,
  type ImeiCatalogDevice,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import { PETROCK_CHECK_MAP_PART_1 } from './check-catalog-data/part-1';
import { PETROCK_CHECK_MAP_PART_2 } from './check-catalog-data/part-2';
import { PETROCK_CHECK_MAP_PART_3 } from './check-catalog-data/part-3';
import { PETROCK_CHECK_MAP_PART_4 } from './check-catalog-data/part-4';
import { PETROCK_CHECK_MAP_PART_5 } from './check-catalog-data/part-5';
import { PETROCK_CHECK_MAP_PART_6 } from './check-catalog-data/part-6';
import { PETROCK_CHECK_MAP_PART_7 } from './check-catalog-data/part-7';
import type { PetrockCheckMapping } from './check-catalog-data/types';

export const PETROCK_CHECK_CATALOG_RETRIEVED_AT = '2026-10-25T16:20:36.274Z';
export const PETROCK_CHECK_MAPPINGS: readonly PetrockCheckMapping[] = [
  ...PETROCK_CHECK_MAP_PART_1,
  ...PETROCK_CHECK_MAP_PART_2,
  ...PETROCK_CHECK_MAP_PART_3,
  ...PETROCK_CHECK_MAP_PART_4,
  ...PETROCK_CHECK_MAP_PART_5,
  ...PETROCK_CHECK_MAP_PART_6,
  ...PETROCK_CHECK_MAP_PART_7,
];

export function findPetrockCheckMapping(productId: string) {
  return PETROCK_CHECK_MAPPINGS.find((row) => row.productId === productId);
}

/** Catalog projection is read-only: related legacy tiers do not prove supplier
 * output equivalence, and a successful single-device probe does not activate it.
 */
export function getPetrockCheckCatalog(
  filter: { brand?: ImeiCatalogBrand; device?: ImeiCatalogDevice } = {}
) {
  return groupImeiCheckCatalog(filter)
    .flatMap((group) =>
      group.entries.map((entry) => {
        const variants = PETROCK_CHECK_MAPPINGS.filter(
          (row) =>
            row.entryId === entry.id &&
            (!filter.brand ||
              (row.brandScope ?? entry.brands).includes('all') ||
              (row.brandScope ?? entry.brands).includes(filter.brand)) &&
            (!filter.device ||
              (row.deviceScope ?? entry.devices).includes(filter.device))
        );
        return {
          ...entry,
          groupLabel: group.label,
          variants,
          relatedCustomerPrices: entry.relatedTierKeys.map((tierKey) => ({
            tierKey,
            priceNgn: IMEI_SERVICE_TIERS[tierKey].price,
          })),
          newEntry: entry.relatedTierKeys.length === 0,
          customerPriceNgn: null,
          /** Mapping never grants a new customer purchase capability. */
          activationRequired: true,
        };
      })
    )
    .filter((entry) => entry.variants.length > 0);
}

export function getPetrockMappingsForTier(tierKey: ImeiServiceTierKey) {
  return PETROCK_CHECK_MAPPINGS.filter((row) =>
    IMEI_CHECK_CATALOG[row.entryId].relatedTierKeys.includes(tierKey)
  );
}

export function getPetrockMappingBlockers(productId: string): string[] {
  const row = findPetrockCheckMapping(productId);
  if (!row) return ['unmapped_product'];
  const entry = IMEI_CHECK_CATALOG[row.entryId];
  return [
    ...(row.evidence === 'rejected_probe' ? ['rejected_provider_probe'] : []),
    ...(row.evidence !== 'successful_probe'
      ? ['response_verification_required']
      : ['device_and_identifier_scope_verification_required']),
    ...(row.identifiers.every((kind) => kind !== 'imei' && kind !== 'serial')
      ? ['unsupported_identifier_form']
      : []),
    ...(entry.relatedTierKeys.length === 0
      ? ['customer_price_required']
      : ['legacy_tier_coverage_review_required']),
    'explicit_rollout_required',
  ];
}
