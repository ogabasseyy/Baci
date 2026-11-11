import { JsonLd } from '@/components/seo/json-ld';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { generateFAQSchema } from '@/lib/seo-utils';
import { resolveStorefrontFaqItems } from './resolve-faq-items';

export interface FAQJsonLdProps {
  params: Promise<{ slug: string }>;
}

/** Streams FAQ JSON-LD structured data independently of page content. */
export async function FAQJsonLd({ params }: FAQJsonLdProps) {
  const { slug } = await params;
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) return null;

  const faqItems = resolveStorefrontFaqItems(merchant);
  if (faqItems.length === 0) return null;

  const faqSchema = generateFAQSchema(faqItems);

  return <JsonLd data={faqSchema} />;
}
