import { isPlausibleMerchantContactPhone } from './merchant-contact-phone';

const FORMATTING_CHARACTERS = /[() .-]/g;
// Numbers that become 234 plus ten digits when booking reads
// them as Nigerian: 0XXXXXXXXXX, 234[0]XXXXXXXXXX, or a bare ten-digit number
// that does not already start with 234.
const NIGERIAN_NATIONAL_NUMBER =
  /^(?:0[1-9][0-9]{9}|2340?[1-9][0-9]{9}|(?!234)[1-9][0-9]{9})$/;

/**
 * Shape check for `merchants.phone`, the sender contact couriers receive.
 * Booking (normalizePhoneToE164) treats a number as international only when it
 * starts with `+` or `00`, and reads anything else, including "(+44) ...", as
 * Nigerian. Such a number must therefore be a complete Nigerian number; other
 * countries need a leading country code. `support_phone` keeps the looser
 * isPlausibleMerchantContactPhone rule.
 *
 * Mirrors the `phone` rule in `update_merchant_identity_settings`
 * (20261031120000_require_complete_merchant_contact_phones.sql). Blank values
 * return `false`; callers decide whether clearing is allowed.
 */
export function isPlausibleMerchantSenderPhone(
  raw: string | null | undefined
): boolean {
  if (typeof raw !== 'string' || !isPlausibleMerchantContactPhone(raw)) {
    return false;
  }
  const trimmed = raw.trim();
  const compact = trimmed.replace(FORMATTING_CHARACTERS, '');
  return (
    trimmed.startsWith('+') ||
    compact.startsWith('00') ||
    NIGERIAN_NATIONAL_NUMBER.test(compact.replace(/^\+/, ''))
  );
}
