import { isPlausibleMerchantContactPhone } from '@baci/shared/lib';
import z from 'zod';

export { extractBrandColorsFromImage as extractColorsFromImage } from '@/lib/extract-brand-colors';

import { sanitizeText } from '@/lib/sanitize-core';
import { onboardingCountrySchema } from '@/schemas/onboarding-country';

export const settingsSchema = z.object({
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
  support_phone: z
    .string()
    .trim()
    .max(32, 'Support phone must be 32 characters or fewer.')
    .refine(
      (value) => value === '' || isPlausibleMerchantContactPhone(value),
      'Enter a full support phone number, for example +234 801 234 5678.'
    )
    .default(''),
});

export type SettingsFormValues = z.infer<typeof settingsSchema>;

export const sanitizeSocialMedia = (social: Record<string, string>) => {
  return Object.fromEntries(
    Object.entries(social).map(([key, value]) => [
      key,
      sanitizeText(value.trim()),
    ])
  );
};
