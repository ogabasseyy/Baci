import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { OgabasseyV2HelpSupport } from '@/components/storefront/ogabassey/pages/help-support';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import { generateOrganizationSchema } from '@/lib/seo-utils';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { ContentPageCrawlSummary } from '../content-page-crawl-summary';
import { ContactPageClient } from '../pages/contact/contact-page-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function ContactPageContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  const baseUrl = buildRequestScopedStoreUrl(merchant, await headers());
  const trustProfile = buildMerchantTrustProfile(merchant, baseUrl);

  const hasContactInfo = [
    merchant.pages?.contact,
    merchant.email,
    merchant.phone,
    trustProfile.supportEmail,
    trustProfile.supportPhone,
  ].some(hasNonEmptyText);

  if (!hasContactInfo) {
    notFound();
  }

  const contactSchema = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: `Contact ${merchant.business_name}`,
    url: `${baseUrl}/contact`,
    mainEntity: generateOrganizationSchema({
      name: merchant.business_name,
      url: baseUrl,
      country: merchant.country,
      logo: merchant.logo_url || undefined,
      email: trustProfile.supportEmail || merchant.email || undefined,
      telephone: trustProfile.supportPhone || merchant.phone || undefined,
      socialMedia:
        Object.keys(trustProfile.socialLinks).length > 0
          ? trustProfile.socialLinks
          : (merchant.social_media as Record<string, string> | undefined),
      trustProfile,
    }),
  };

  const jsonLdScript = <JsonLd data={contactSchema} />;

  // Only the Ogabassey template defines a Contact page; import it directly so
  // this route's chunk carries exactly this page (the old info-pages map
  // fanned all ten info pages into every content route's graph). The JSX
  // itself is constructed outside so render errors flow to the route error
  // boundary. The direct component takes only `merchant` (it ignores the
  // storeSlug/isPreview the map used to spread through).
  const ContactComponent =
    merchant.template_id === OGABASSEY_TEMPLATE_ID
      ? OgabasseyV2HelpSupport
      : null;

  if (ContactComponent) {
    return (
      <>
        {jsonLdScript}
        <ContactComponent merchant={toTemplateMerchantData(merchant)} />
        <ContentPageCrawlSummary
          kind="contact"
          merchantName={merchant.business_name}
          businessType={merchant.business_type}
        />
      </>
    );
  }

  return (
    <>
      {jsonLdScript}
      <ContactPageClient
        merchant={merchant}
        legacyContent={merchant.pages?.contact}
      >
        <ContentPageCrawlSummary
          kind="contact"
          merchantName={merchant.business_name}
          businessType={merchant.business_type}
        />
      </ContactPageClient>
    </>
  );
}
