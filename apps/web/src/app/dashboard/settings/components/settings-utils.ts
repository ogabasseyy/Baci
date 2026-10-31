import { isPlausibleMerchantContactPhone } from '@baci/shared/lib';
import z from 'zod';

export { extractBrandColorsFromImage as extractColorsFromImage } from '@/lib/extract-brand-colors';

import { sanitizeText } from '@/lib/sanitize-core';
import { onboardingCountrySchema } from '@/schemas/onboarding-country';
import {
  isStorefrontProfileValueChanged,
  type StorefrontProfileValues,
} from './storefront-profile-values';

/** The loaded contact numbers a save compares against (see save-settings). */
export type ContactPhoneBaseline = Partial<
  Pick<StorefrontProfileValues, 'phone' | 'support_phone'>
>;

/**
 * A merchant contact number (`merchants.phone` / `merchants.support_phone`).
 * Blank clears it. Any other value must be a complete number, but only when
 * the save would write it: a value equal to its loaded baseline is never sent,
 * so a legacy truncated number cannot block an unrelated save. This matches
 * the mobile Store Settings validator and the database, which check only the
 * phone numbers a save changes.
 */
function contactPhoneSchema({
  baselineValue,
  label,
  message,
}: {
  baselineValue: string | undefined;
  label: string;
  message: string;
}) {
  return z
    .string()
    .trim()
    .max(32, `${label} must be 32 characters or fewer.`)
    .refine(
      (value) =>
        value === '' ||
        !isStorefrontProfileValueChanged(value, baselineValue) ||
        isPlausibleMerchantContactPhone(value),
      message
    )
    .default('');
}

/**
 * Builds the Store Settings schema. Pass the form's current profile baseline
 * so unchanged legacy phone numbers are not re-checked; without a baseline
 * every non-blank phone number must be complete.
 */
export function createSettingsSchema(baseline: ContactPhoneBaseline = {}) {
  return z.object({
    business_name: z
      .string()
      // Trim first so a stray trailing/leading space can't be saved as the store
      // name (the DB also normalizes this; see the aa_normalize_merchant_business_name
      // trigger). Length is checked against the trimmed value.
      .trim()
      .min(2, 'Business name must be at least 2 characters.'),
    // Shared with onboarding: accepts an ISO-2 code, a full country name, or a
    // known alias and normalizes it to the canonical ISO-2 code, so the
    // settings form can never round-trip 'Nigeria' or other free-text garbage
    // back into `merchants.country`.
    country: onboardingCountrySchema,
    site_description: z
      .string()
      .trim()
      .max(320, 'Store description must be 320 characters or fewer.')
      .transform((value) => sanitizeText(value))
      .default(''),
    support_email: z
      .string()
      .trim()
      .max(255, 'Support email must be 255 characters or fewer.')
      .transform((value) => value.toLowerCase())
      .refine(
        (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
        'Enter a valid support email address.'
      )
      .default(''),
    support_phone: contactPhoneSchema({
      baselineValue: baseline.support_phone,
      label: 'Support phone',
      message:
        'Enter a full support phone number, for example +234 801 234 5678.',
    }),
    // merchants.phone: the number couriers call to arrange pickups. Blank keeps
    // the mobile Store Settings contract (the save clears it, and booking then
    // asks for a full number).
    phone: contactPhoneSchema({
      baselineValue: baseline.phone,
      label: 'Business phone',
      message:
        'Enter the full business phone number with its country code, for example +234 801 234 5678.',
    }),
  });
}

/** The baseline-free schema: the shape of the form and its strictest rules. */
export const settingsSchema = createSettingsSchema();

export type SettingsFormValues = z.infer<typeof settingsSchema>;

export const sanitizeSocialMedia = (social: Record<string, string>) => {
  return Object.fromEntries(
    Object.entries(social).map(([key, value]) => [
      key,
      sanitizeText(value.trim()),
    ])
  );
};
