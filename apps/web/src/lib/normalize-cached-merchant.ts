import { OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { normalizeOgabasseyBusinessType } from '@/lib/storefront/ogabassey-entity';
import { canonicalizeStorefrontMediaUrl } from '@/lib/storefront-media-cdn-url';

export type CachedMerchantMediaFields = {
  custom_domain?: string | null;
  favicon_apple_touch_url?: string | null;
  favicon_png_32_url?: string | null;
  favicon_svg_url?: string | null;
  id?: string | null;
  logo_url?: string | null;
  slug?: string | null;
};

export function isOgabasseyMerchantEntity(merchant: CachedMerchantMediaFields) {
  const customDomain = merchant.custom_domain?.toLowerCase();
  const slug = merchant.slug?.toLowerCase();

  return (
    merchant.id === OGABASSEY_MERCHANT_ID ||
    customDomain === 'ogabassey.com' ||
    slug === 'ogabassey'
  );
}

function canonicalizeMerchantMediaUrl(value: string | null | undefined) {
  if (!value) {
    return value;
  }

  return canonicalizeStorefrontMediaUrl(value) ?? value;
}

export function withStorefrontMediaCdnUrls<T extends CachedMerchantMediaFields>(
  merchant: T
): T {
  if (!isOgabasseyMerchantEntity(merchant)) {
    return merchant;
  }

  return {
    ...merchant,
    favicon_apple_touch_url: canonicalizeMerchantMediaUrl(
      merchant.favicon_apple_touch_url
    ),
    favicon_png_32_url: canonicalizeMerchantMediaUrl(
      merchant.favicon_png_32_url
    ),
    favicon_svg_url: canonicalizeMerchantMediaUrl(merchant.favicon_svg_url),
    logo_url: canonicalizeMerchantMediaUrl(merchant.logo_url),
  } as T;
}

export function normalizeCachedMerchantEntity<
  T extends {
    business_type?: string | null;
    custom_domain?: string | null;
    favicon_apple_touch_url?: string | null;
    favicon_png_32_url?: string | null;
    favicon_svg_url?: string | null;
    id?: string | null;
    logo_url?: string | null;
    slug?: string | null;
    template_id?: string | null;
  },
>(merchant: T): Omit<T, 'business_type'> & { business_type: string } {
  const merchantWithCdnMedia = withStorefrontMediaCdnUrls(merchant);

  return {
    ...merchantWithCdnMedia,
    business_type: normalizeOgabasseyBusinessType(merchantWithCdnMedia),
  };
}

export function redactUnpublishedMerchantContactFields<
  T extends {
    business_address?: unknown;
    email?: unknown;
    is_published?: boolean | null;
    legal_entity_name?: unknown;
    phone?: unknown;
    registered_address?: unknown;
    support_email?: unknown;
    support_phone?: unknown;
    tax_identification_number?: unknown;
    trust_profile?: unknown;
  },
>(merchant: T): T {
  if (merchant.is_published) return merchant;

  merchant.email = '';
  merchant.phone = '';
  merchant.support_email = '';
  merchant.support_phone = '';
  merchant.business_address = '';
  merchant.legal_entity_name = null;
  merchant.registered_address = null;
  merchant.tax_identification_number = null;
  merchant.trust_profile = null;
  return merchant;
}
