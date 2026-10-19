/**
 * Contact helpers for negotiation follow-up. When a customer submits an offer
 * for merchant approval, they can attach a phone/WhatsApp number so the merchant
 * can reach them — most offers come from guests who otherwise receive no push or
 * email when the offer is decided, so this number is the only reliable channel.
 *
 * Storefronts (web + mobile) normalize the typed number before persisting it on
 * `negotiation_requests.customer_phone`; the admin app reads it back to build
 * `tel:` and WhatsApp (`wa.me`) deep links. One source of truth for the format
 * keeps the write side and the link-building read side in agreement.
 */

import { normalizeNegotiationCustomerEmail } from './negotiation-email';

/** Default dialing code for the pilot market (Nigeria). */
export const DEFAULT_DIAL_CODE = '234';

/**
 * Normalize a raw, human-typed phone number into bare E.164 digits (no `+`,
 * no spaces), or `null` when it can't be a real number.
 *
 * Handles the common Nigerian-input shapes:
 *  - `0803 123 4567`      → leading 0 dropped, dial code prefixed → `2348031234567`
 *  - `+234 803 123 4567`  → `+` stripped → `2348031234567`
 *  - `234 803 123 4567`   → already has dial code → `2348031234567`
 *  - `803 123 4567`       → bare national number → dial code prefixed
 *
 * Anything shorter than a plausible national number (8 digits) or absurdly long
 * (> 15, the E.164 max) returns `null` so callers can hide contact actions
 * rather than build a broken link.
 */
export function normalizePhoneToE164(
  raw: string | null | undefined,
  dialCode: string = DEFAULT_DIAL_CODE
): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (digits.length === 0) {
    return null;
  }

  const stripDialCodeTrunkZero = () => {
    if (digits.startsWith(`${dialCode}0`)) {
      digits = `${dialCode}${digits.slice(dialCode.length + 1)}`;
    }
  };

  if (hadPlus) {
    if (digits.startsWith('0')) {
      // Mixed international marker + national trunk form, e.g. "+08031234567".
      digits = dialCode + digits.slice(1);
    } else {
      // Already international (e.g. "+2348031234567"); trust the typed country code.
      stripDialCodeTrunkZero();
    }
  } else if (digits.startsWith('00')) {
    // International prefix form, e.g. "002348031234567".
    digits = digits.slice(2);
    stripDialCodeTrunkZero();
  } else if (digits.startsWith('0')) {
    // National form with trunk 0, e.g. "08031234567" → drop 0, add dial code.
    digits = dialCode + digits.slice(1);
  } else if (digits.startsWith(dialCode)) {
    // Already prefixed with the dial code but no leading + or 0.
    stripDialCodeTrunkZero();
  } else {
    // Bare national number without trunk 0, e.g. "8031234567".
    digits = dialCode + digits;
  }

  // E.164 allows up to 15 digits; require at least 8 to reject junk input.
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  return digits;
}

/**
 * Validate a phone value supplied by an identity provider as already-E.164.
 * Unlike customer-entered national numbers, account phones must never inherit
 * the storefront's default dial code.
 */
export function normalizeStoredE164Phone(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  const digits = trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

/** True when `raw` normalizes to a plausible phone number. */
export function isValidPhone(
  raw: string | null | undefined,
  dialCode: string = DEFAULT_DIAL_CODE
): boolean {
  return normalizePhoneToE164(raw, dialCode) !== null;
}

/** `tel:` deep link for a normalized number, or `null` if it can't be dialed. */
export function buildTelLink(
  raw: string | null | undefined,
  dialCode: string = DEFAULT_DIAL_CODE
): string | null {
  const e164 = normalizePhoneToE164(raw, dialCode);
  return e164 ? `tel:+${e164}` : null;
}

/**
 * WhatsApp deep link (`https://wa.me/<digits>?text=...`) for a normalized
 * number, or `null` if it can't be reached. `wa.me` expects digits only with no
 * leading `+`. An optional prefilled message is URL-encoded.
 */
export function buildWhatsAppLink(
  raw: string | null | undefined,
  message?: string,
  dialCode: string = DEFAULT_DIAL_CODE
): string | null {
  const e164 = normalizePhoneToE164(raw, dialCode);
  if (!e164) {
    return null;
  }
  const base = `https://wa.me/${e164}`;
  const text = message?.trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Mail client deep link for a validated negotiation email address. Optional
 * subject/body values are URL-encoded so merchant follow-up opens prefilled
 * without allowing malformed recipient values into the link.
 */
export function buildMailtoLink(
  rawEmail: string | null | undefined,
  subject?: string,
  body?: string
): string | null {
  const email = normalizeNegotiationCustomerEmail(rawEmail);
  if (!email) {
    return null;
  }

  const query = [
    subject?.trim() ? `subject=${encodeURIComponent(subject.trim())}` : null,
    body?.trim() ? `body=${encodeURIComponent(body.trim())}` : null,
  ].filter((value): value is string => value !== null);
  const encodedRecipient = encodeURIComponent(email).replace(/%40/g, '@');

  return query.length > 0
    ? `mailto:${encodedRecipient}?${query.join('&')}`
    : `mailto:${encodedRecipient}`;
}
