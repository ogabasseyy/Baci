import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { OgabasseyV2Quiz } from '@/components/storefront/ogabassey/pages/quiz';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

// Entry is free and ranking is neutral. This copy is a public, indexed promise:
// describing the quiz as played "with loyalty points" advertises a purchase gate
// (points are only ever earned by buying), which is the exact consideration that
// makes a prize quiz a regulated promotional competition. Keep it purchase-free.
const QUIZ_DESCRIPTION =
  'Play the Ogabassey Super Quiz. Free to enter — no purchase needed.';

export const metadata: Metadata = {
  description: QUIZ_DESCRIPTION,
  title: 'Super Quiz | Ogabassey',
};

export default async function QuizPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);

  if (merchant?.template_id !== 'ogabassey') {
    notFound();
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    description: QUIZ_DESCRIPTION,
    name: 'Ogabassey Super Quiz',
  };

  return (
    <section aria-label="Super Quiz">
      <JsonLd data={jsonLd} />
      <OgabasseyV2Quiz merchantSlug={merchant.slug} />
    </section>
  );
}
