import { hasMinimumPhoneDigits } from '@/lib/phone';

/** Clear fail-closed message when schema length is padded with separators. */
export function repairPickupCustomerPhoneError(phone: string): string | null {
  if (hasMinimumPhoneDigits(phone)) return null;
  return 'Enter a valid phone number with at least 10 digits.';
}
