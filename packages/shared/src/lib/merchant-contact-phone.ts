/**
 * Shape check for merchant contact numbers (`merchants.phone` and
 * `merchants.support_phone`). Couriers receive the store phone verbatim as the
 * sender contact, so a truncated value such as "+23415781" must never be
 * saved.
 *
 * The rule mirrors the database check in `update_merchant_identity_settings`
 * so the apps never accept a value the database rejects:
 *  - only digits, spaces, parentheses, dots, dashes and a leading `+`/`00`;
 *  - Nigerian numbers (`+234`/`00234`) need exactly ten national digits, with
 *    an optional trunk 0 (the phone picker keeps it when typed);
 *  - other international numbers must be E.164 (8-15 digits, no leading 0);
 *  - national-format numbers carry no country, so they only need 7-15 digits.
 *
 * Blank values return `false`; callers decide whether clearing is allowed.
 */
const ALLOWED_PHONE_CHARACTERS = /^[+0-9() .-]{7,32}$/;
const FORMATTING_CHARACTERS = /[() .-]/g;

export function isPlausibleMerchantContactPhone(
  raw: string | null | undefined
): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (!ALLOWED_PHONE_CHARACTERS.test(value)) return false;

  const compact = value.replace(FORMATTING_CHARACTERS, '');
  if (!/^(?:\+|00)?[0-9]+$/.test(compact)) return false;
  if (/^(?:\+|00)234/.test(compact)) {
    return /^(?:\+|00)2340?[1-9][0-9]{9}$/.test(compact);
  }
  if (/^(?:\+|00)/.test(compact)) {
    return /^(?:\+|00)[1-9][0-9]{7,14}$/.test(compact);
  }
  return /^[0-9]{7,15}$/.test(compact);
}
