import type { CachedMerchant } from '@/lib/cached-data';
import type { MerchantSettingsSnapshot } from './get-merchant-settings-snapshot';

export type StorefrontProfileValues = Omit<
  MerchantSettingsSnapshot,
  'updated_at'
>;

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
