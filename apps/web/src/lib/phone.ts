/**
 * Phone number formatting utilities
 *
 * Shared across integrations (MyCover, Juicyway, etc.)
 */

/** Count digits after stripping separators (spaces, dashes, plus, etc.). */
export function countPhoneDigits(phone: string): number {
  return phone.replace(/\D/g, '').length;
}

/** Fail-closed gate for courier / payment flows that need a usable phone. */
export function hasMinimumPhoneDigits(
  phone: string,
  minimumDigits = 10
): boolean {
  return countPhoneDigits(phone) >= minimumDigits;
}

/**
 * Format phone number to E.164 format (+234...)
 */
export function formatPhoneToE164(phone: string, countryCode = '+234'): string {
  const trimmed = phone.trim();

  // Preserve already-international numbers (any country code, not just +234)
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return digits ? `+${digits}` : '';
  }

  const digits = trimmed.replace(/\D/g, '');

  if (digits.startsWith('234') && digits.length === 13) {
    return `+${digits}`;
  }

  const normalized = digits.startsWith('0') ? digits.slice(1) : digits;

  if (!normalized) return '';

  return `${countryCode}${normalized}`;
}

/**
 * Format phone number for MyCover API (234... without + prefix)
 */
export function formatPhoneForMyCover(phone: string): string {
  const e164 = formatPhoneToE164(phone);
  return e164.replace(/^\+/, '');
}
