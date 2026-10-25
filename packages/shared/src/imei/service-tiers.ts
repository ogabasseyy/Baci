import { ANDROID_IMEI_SERVICE_TIERS } from './service-tier-android';
import { APPLE_IMEI_SERVICE_TIERS } from './service-tier-apple';
import { APPLE_DEVICE_IMEI_SERVICE_TIERS } from './service-tier-apple-devices';
import { CORE_IMEI_SERVICE_TIERS } from './service-tier-core';
import { PETROCK_DEVICE_IMEI_SERVICE_TIERS } from './service-tier-petrock-device';
import { PETROCK_NETWORK_IMEI_SERVICE_TIERS } from './service-tier-petrock-network';
import type {
  ImeiBrandFilter,
  ImeiDeviceCategory,
  ImeiIdentifierType,
  ImeiServiceBrandScope,
} from './service-tier-types';

export * from './service-tier-types';

export const IMEI_SERVICE_TIERS = {
  ...CORE_IMEI_SERVICE_TIERS,
  ...APPLE_IMEI_SERVICE_TIERS,
  ...APPLE_DEVICE_IMEI_SERVICE_TIERS,
  ...ANDROID_IMEI_SERVICE_TIERS,
  ...PETROCK_DEVICE_IMEI_SERVICE_TIERS,
  ...PETROCK_NETWORK_IMEI_SERVICE_TIERS,
} as const;

export type ImeiServiceTierKey = keyof typeof IMEI_SERVICE_TIERS;

/** Phase 3 catalog candidates. These keys are deliberately not purchasable. */
export const PETROCK_DARK_IMEI_SERVICE_TIERS = [
  'esimCompatibility',
  'refurbishedStatus',
  'replacementStatus',
  'applePartNumber',
  'knoxEnrollment',
  'samsungSoldBy',
  'oneplusPremium',
  'transsionPremium',
  'macInfo',
  'macPhotoReport',
  'applePremium',
  'applePremiumMax',
  'attFinance',
  'tmobileFinance',
  'verizonFinance',
  'tracfoneFinance',
  'xfinityFinance',
  'japanDocomo',
  'japanSoftbank',
  'japanKddi',
  'japanRakuten',
  'japanNetwork',
] as const satisfies readonly ImeiServiceTierKey[];

export const PRIMARY_IMEI_SERVICE_TIERS = [
  'full',
  'basic',
  'blacklist',
  'carrier',
] as const satisfies readonly ImeiServiceTierKey[];

/**
 * Tiers that are live and purchasable. Single source of truth shared by the web
 * route gate and the mobile display filter. Previously only the primary 4 were
 * live; the device-category expansion turns on the full catalog.
 */
export const PUBLIC_IMEI_SERVICE_TIERS = [
  'full',
  'activation',
  'blacklist',
  'blacklistPro',
  'carrier',
  'simLock',
  'icloud',
  'icloudPro',
  'icloudCleanLost',
  'carrierFmi',
  'basic',
  'appleBasic',
  'serialInfo',
  'macIcloud',
  'soldByCountry',
  'gsxPremium',
  'gsxRepairs',
  'repairEligibility',
  'replacementHistory',
  'demoUnit',
  'mdm',
  'samsung',
  'samsungPro',
  'knoxGuard',
  'miLock',
  'miLostPro',
  'pixel',
  'oppoRealme',
  'transsion',
] as const satisfies readonly ImeiServiceTierKey[];

/**
 * Every tier the selectors iterate. Derived from `PUBLIC_IMEI_SERVICE_TIERS`
 * (the source of truth) so the two lists cannot drift: every purchasable tier is
 * displayable and vice-versa. If a future tier is ever catalog-only (not public),
 * split this back into its own explicit list.
 */
export const ALL_IMEI_SERVICE_TIERS = PUBLIC_IMEI_SERVICE_TIERS;

/** Default identifier the input uses for each device category. */
export const IMEI_IDENTIFIER_BY_DEVICE: Record<
  ImeiDeviceCategory,
  ImeiIdentifierType
> = {
  // Phones are IMEI-first but iPhones also have a serial, so 'both' keeps the
  // shared Apple 'both' tiers (activation/mdm/demoUnit) accepting a serial on
  // the phone tab. IMEI-only tiers (e.g. Android) keep 'imei' via their own
  // tier identifier, which resolveInputIdentifier never widens.
  smartphone: 'both',
  tablet: 'both',
  laptop: 'serial',
  watch: 'serial',
};

/** Cards shown before the "show all services" toggle, per device. */
const PRIMARY_TIERS_BY_DEVICE: Record<
  ImeiDeviceCategory,
  readonly ImeiServiceTierKey[]
> = {
  smartphone: ['full', 'basic', 'blacklist', 'carrier'],
  tablet: ['activation', 'icloud', 'mdm', 'gsxPremium'],
  laptop: ['macIcloud', 'activation', 'mdm', 'gsxPremium'],
  watch: ['activation', 'repairEligibility', 'gsxPremium'],
};

/** The star-flagged default check per device. */
export const RECOMMENDED_TIER_BY_DEVICE: Record<
  ImeiDeviceCategory,
  ImeiServiceTierKey
> = {
  smartphone: 'full',
  tablet: 'activation',
  laptop: 'macIcloud',
  watch: 'activation',
};

export function isImeiServiceTierKey(
  value: unknown
): value is ImeiServiceTierKey {
  // Object.keys (own enumerable only) rejects inherited keys like 'toString'
  // and '__proto__' without needing Object.hasOwn (ES2022, not in shared's lib).
  return (
    typeof value === 'string' &&
    (Object.keys(IMEI_SERVICE_TIERS) as string[]).includes(value)
  );
}

export function imeiTierMatchesBrand(
  tierKey: ImeiServiceTierKey,
  brand: ImeiBrandFilter
): boolean {
  const scopes: readonly ImeiServiceBrandScope[] =
    IMEI_SERVICE_TIERS[tierKey].brandScopes;
  return scopes.includes('all') || scopes.includes(brand);
}

export function imeiTierMatchesDevice(
  tierKey: ImeiServiceTierKey,
  category: ImeiDeviceCategory
): boolean {
  const categories: readonly ImeiDeviceCategory[] =
    IMEI_SERVICE_TIERS[tierKey].deviceCategories;
  return categories.includes(category);
}

export function getVisibleImeiServiceTierKeys(
  brand: ImeiBrandFilter,
  expanded: boolean
): ImeiServiceTierKey[] {
  const baseTiers = expanded
    ? ALL_IMEI_SERVICE_TIERS
    : PRIMARY_IMEI_SERVICE_TIERS;
  return baseTiers.filter((tierKey) => imeiTierMatchesBrand(tierKey, brand));
}

/**
 * Device-aware tier selector: the checks valid for a given device category,
 * further narrowed by brand (brand only meaningfully filters smartphones).
 */
export function getVisibleImeiServiceTierKeysForDevice(
  category: ImeiDeviceCategory,
  brand: ImeiBrandFilter,
  expanded: boolean
): ImeiServiceTierKey[] {
  // The collapsed "primary" list is iPhone-forward, so it would hide almost
  // every Samsung/Android check. When a specific non-Apple brand is picked the
  // matching list is short, so show it in full instead of collapsing it.
  const brandNarrowsToShortList =
    category === 'smartphone' && brand !== 'apple';
  const baseTiers =
    expanded || brandNarrowsToShortList
      ? ALL_IMEI_SERVICE_TIERS
      : PRIMARY_TIERS_BY_DEVICE[category];
  return baseTiers.filter(
    (tierKey) =>
      imeiTierMatchesDevice(tierKey, category) &&
      imeiTierMatchesBrand(tierKey, brand)
  );
}

/** True when expanding "show all services" would reveal extra checks. */
export function hasAdditionalImeiServiceTierKeysForDevice(
  category: ImeiDeviceCategory,
  brand: ImeiBrandFilter
): boolean {
  return (
    getVisibleImeiServiceTierKeysForDevice(category, brand, true).length >
    getVisibleImeiServiceTierKeysForDevice(category, brand, false).length
  );
}
