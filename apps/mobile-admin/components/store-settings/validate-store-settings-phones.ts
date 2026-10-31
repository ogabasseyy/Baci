import { isPlausibleMerchantContactPhone } from '@baci/shared';
import type { EditableMerchantColumns } from './store-settings-payload';

const PHONE_FIELDS = [
  ['phone', 'Phone Number'],
  ['support_phone', 'Support Phone'],
] as const;

/**
 * Checks only the phone numbers a save would write. Couriers receive the store
 * phone as the sender contact, so a truncated number must not be saved.
 * Returns the message to show, or null when the save may continue.
 */
export function validateStoreSettingsPhones(
  payload: Partial<EditableMerchantColumns>
): string | null {
  for (const [key, label] of PHONE_FIELDS) {
    const value = payload[key];
    if (
      typeof value === 'string' &&
      value.trim() !== '' &&
      !isPlausibleMerchantContactPhone(value)
    ) {
      return `${label} looks incomplete. Enter the full number with its country code, for example +234 801 234 5678.`;
    }
  }
  return null;
}
