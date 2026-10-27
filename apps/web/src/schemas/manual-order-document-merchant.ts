import { z } from 'zod';

const number = z.coerce.number().finite().nonnegative();
const nullableText = z.string().nullable();

function normalizeLegacyBrandColors(value: unknown): unknown {
  // Legacy merchant rows may store brand_colors with only `primary` (the
  // JSONB column is unconstrained). Fill the missing keys from the primary
  // color, mirroring the mobile receipt hook, instead of rejecting the
  // merchant and failing the notification.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const colors = value as Record<string, unknown>;
  if (typeof colors.primary !== 'string') {
    return value;
  }
  return {
    background: colors.primary,
    accent: colors.primary,
    ...colors,
  };
}

export const manualDocumentMerchantSchema = z.object({
  id: z.string(),
  // The slug becomes a claim-URL subdomain label only when no safe custom
  // domain wins: the sender validates it conditionally after claim prep
  // (see send-manual-order-document.ts), so a legacy unsafe or null slug
  // must not sink a merchant whose custom domain resolves. Null/unsafe
  // slugs skip as merchant_validation_failed only on the fallback-host
  // path, and recover through the merchant re-arm.
  slug: nullableText,
  business_name: nullableText,
  email_sender_name: nullableText,
  logo_url: nullableText,
  email: z.string(),
  phone: nullableText,
  support_email: nullableText,
  support_phone: nullableText,
  business_address: nullableText,
  registered_address: z
    .object({
      street: nullableText.optional(),
      city: nullableText.optional(),
      state: nullableText.optional(),
      postal_code: nullableText.optional(),
      country: nullableText.optional(),
    })
    .nullable()
    // The JSONB column is unconstrained: fall back to the business address
    // instead of rejecting the merchant (a merchant fix cannot re-arm the
    // outbox row, so strictness here would silently drop the document).
    .catch(null),
  cac_rc_number: nullableText,
  tax_identification_number: nullableText,
  legal_entity_name: nullableText,
  vat_registration_status: nullableText,
  vat_rate: number.nullable(),
  bank_code: nullableText,
  bank_account_number: nullableText,
  bank_name: nullableText,
  bank_account_name: nullableText,
  brand_colors: z.preprocess(
    normalizeLegacyBrandColors,
    z
      .object({
        primary: z.string(),
        background: z.string(),
        accent: z.string(),
      })
      .nullable()
      // Cosmetic only, with null-safe consumers: fall back to default
      // branding instead of rejecting the merchant (see registered_address).
      .catch(null)
  ),
});
