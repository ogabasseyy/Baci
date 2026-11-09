import { notFound } from 'next/navigation';
import { OgabasseyV2HelpSupport } from '@/components/storefront/ogabassey/pages/help-support';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import { ContentPageCrawlSummary } from '../content-page-crawl-summary';
import { FAQPageClient } from '../pages/faq/faq-page-client';
import { resolveStorefrontFaqItems } from './resolve-faq-items';

export interface FAQContentProps {
  params: Promise<{ slug: string }>;
}

export async function FAQContent({ params }: FAQContentProps) {
  const { slug } = await params;
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const faqItems = resolveStorefrontFaqItems(merchant);

  // Resolve template component server-side for SEO (H1 in SSR HTML).
  // Only the Ogabassey template defines a Help page; import it directly so
  // this route's chunk carries exactly this page. Construct JSX outside any
  // guard (try/catch cannot catch React rendering errors, and JSX inside a
  // try block prevents React Compiler optimization).
  const TemplateHelp =
    merchant.template_id === OGABASSEY_TEMPLATE_ID
      ? OgabasseyV2HelpSupport
      : null;
  if (TemplateHelp) {
    const merchantData = {
      ...toTemplateMerchantData(merchant),
      faq_items: faqItems,
    };
    return (
      <>
        <TemplateHelp merchant={merchantData} />
        <ContentPageCrawlSummary
          kind="faq"
          merchantName={merchant.business_name}
          businessType={merchant.business_type}
        />
      </>
    );
  }

  // Fallback to default FAQ page
  return (
    <FAQPageClient
      merchant={merchant}
      faqItems={faqItems}
      legacyContent={merchant.pages?.faq}
    >
      <ContentPageCrawlSummary
        kind="faq"
        merchantName={merchant.business_name}
        businessType={merchant.business_type}
      />
    </FAQPageClient>
  );
}
