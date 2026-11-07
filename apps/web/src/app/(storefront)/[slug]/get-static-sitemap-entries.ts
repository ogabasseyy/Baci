import type { MetadataRoute } from 'next';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { hasAnyRenderedAboutField } from '@/types/about-page';
import { hasPublishableFaqContent } from '@/types/faq';
import { isStorefrontStaticSitemapEligible } from './is-storefront-static-sitemap-eligible';
import type { SitemapStaticMerchant } from './sitemap-static-merchant';

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasPublishableContactInfo(
  merchant: {
    pages?: { contact?: string | null } | null;
    email?: string | null;
    phone?: string | null;
  },
  trustProfile: {
    supportEmail?: string;
    supportPhone?: string;
  }
): boolean {
  return [
    merchant.pages?.contact,
    merchant.email,
    merchant.phone,
    trustProfile.supportEmail,
    trustProfile.supportPhone,
  ].some(hasNonEmptyText);
}

export function isLegalPagePublishable(
  merchant: {
    template_id?: string | null;
    pages?: { privacy?: string | null; terms?: string | null } | null;
  },
  kind: 'privacy' | 'terms'
): boolean {
  const hasPageContent = Boolean(merchant.pages?.[kind]);
  const templateHasPolicyPage =
    Boolean(merchant.template_id) &&
    merchant.template_id !== 'default' &&
    merchant.template_id !== 'puck';
  return hasPageContent || templateHasPolicyPage;
}

export function getStaticSitemapEntries({
  merchant,
  storeUrl,
}: {
  merchant: SitemapStaticMerchant;
  storeUrl: string;
}): MetadataRoute.Sitemap {
  if (!isStorefrontStaticSitemapEligible(merchant, storeUrl)) {
    return [];
  }

  const lastModified = merchant.updated_at
    ? new Date(merchant.updated_at)
    : undefined;

  const entries: MetadataRoute.Sitemap = [
    { url: storeUrl, lastModified, changeFrequency: 'daily', priority: 1 },
    {
      url: `${storeUrl}/products`,
      lastModified,
      changeFrequency: 'daily',
      priority: 0.9,
    },
  ];

  if (hasPublishableFaqContent(merchant)) {
    entries.push({
      url: `${storeUrl}/faq`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    });
  }

  const hasAbout =
    merchant.template_id === OGABASSEY_TEMPLATE_ID ||
    (merchant.about_page != null &&
      typeof merchant.about_page === 'object' &&
      hasAnyRenderedAboutField(merchant.about_page)) ||
    hasNonEmptyText(merchant.pages?.about);

  if (hasAbout) {
    entries.push({
      url: `${storeUrl}/about`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  const trustProfile = buildMerchantTrustProfile(merchant, storeUrl);
  const hasContact = hasPublishableContactInfo(merchant, trustProfile);

  if (hasContact) {
    entries.push({
      url: `${storeUrl}/contact`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  return entries;
}
