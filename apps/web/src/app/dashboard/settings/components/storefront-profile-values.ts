import type { CachedMerchant } from '@/lib/cached-data';
import type { MerchantSettingsSnapshot } from './get-merchant-settings-snapshot';

export type StorefrontProfileValues = Omit<
  MerchantSettingsSnapshot,
  'updated_at'
>;

/**
 * Whether a save would write this submitted profile value: a field the
 * submission did not carry is never sent, and neither is a value equal to the
 * loaded baseline (a blank baseline counts as an empty string).
 */
export function isStorefrontProfileValueChanged(
  value: string | undefined,
  baselineValue: string | null | undefined
): boolean {
  return value !== undefined && value !== (baselineValue ?? '');
}

/**
 * The editable identity/profile values the settings form starts from. Blank
 * database values become empty strings so an untouched field never looks
 * changed (and is never written back) on save.
 */
export function getStorefrontProfileValues(
  merchant: CachedMerchant
): StorefrontProfileValues {
  return {
    business_name: merchant.business_name || '',
    country: merchant.country || 'NG',
    phone: merchant.phone || '',
    site_description: merchant.site_description || '',
    support_email: merchant.support_email || '',
    support_phone: merchant.support_phone || '',
  };
}
