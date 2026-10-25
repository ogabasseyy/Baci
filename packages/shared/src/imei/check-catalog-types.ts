import type { ImeiServiceGoalId } from './service-groups';
import type { ImeiDeviceCategory, ImeiServiceTierKey } from './service-tiers';

export type ImeiCatalogDevice =
  | ImeiDeviceCategory
  | 'desktop'
  | 'graphics-card';
/** Brand scopes for the broader catalog. These do not add live brand filters. */
export type ImeiCatalogBrand =
  | 'all'
  | 'apple'
  | 'samsung'
  | 'google'
  | 'xiaomi'
  | 'oppo'
  | 'tecno'
  | 'infinix'
  | 'itel'
  | 'oneplus'
  | 'realme'
  | 'honor'
  | 'huawei'
  | 'motorola'
  | 'zte'
  | 'lg'
  | 'lenovo'
  | 'hp'
  | 'dell'
  | 'asus';
export interface ImeiCheckCatalogEntry {
  name: string;
  question: string;
  goal: ImeiServiceGoalId;
  brands: readonly ImeiCatalogBrand[];
  devices: readonly ImeiCatalogDevice[];
  /** Related legacy contracts; mapping does not prove complete field equivalence. */
  relatedTierKeys: readonly ImeiServiceTierKey[];
}
export function catalogEntry(
  name: string,
  question: string,
  goal: ImeiServiceGoalId,
  brands: readonly ImeiCatalogBrand[],
  devices: readonly ImeiCatalogDevice[],
  relatedTierKeys: readonly ImeiServiceTierKey[]
): ImeiCheckCatalogEntry {
  return { name, question, goal, brands, devices, relatedTierKeys };
}
