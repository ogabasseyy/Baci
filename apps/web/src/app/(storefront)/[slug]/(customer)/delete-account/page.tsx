import type { Metadata } from 'next';
import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { DeleteAccountContent } from './delete-account-content';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    return { title: 'Delete Account' };
  }

  return {
    title: `Delete Account | ${merchant.business_name}`,
    description: `Request deletion of your ${merchant.business_name} account and associated data.`,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title: `Delete Account | ${merchant.business_name}`,
      description: `Request deletion of your ${merchant.business_name} account.`,
      type: 'website',
      ...(merchant.logo_url && { images: [{ url: merchant.logo_url }] }),
    },
  };
}

/** Streams JSON-LD separately while the visible page content loads. */
export default function StorefrontDeleteAccountPage({ params }: PageProps) {
  return (
    <>
      <Suspense fallback={null}>
        <DeleteAccountJsonLd params={params} />
      </Suspense>
      <DeleteAccountContent params={params} />
    </>
  );
}

/** Streams JSON-LD structured data independently of page content. */
async function DeleteAccountJsonLd({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) return null;

  const isDevelopment = process.env.NODE_ENV === 'development';
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com';
  const baseUrl = isDevelopment
    ? `http://localhost:3000/${merchant.slug}`
    : `https://${merchant.slug}.${rootDomain}`;

  const pageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Delete Account | ${merchant.business_name}`,
    url: `${baseUrl}/delete-account`,
    description: `Request deletion of your ${merchant.business_name} account.`,
    isPartOf: {
      '@type': 'WebSite',
      name: merchant.business_name,
      url: baseUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: merchant.business_name,
      url: baseUrl,
      ...(merchant.logo_url && { logo: merchant.logo_url }),
    },
  };

  return <JsonLd data={pageSchema} />;
}
