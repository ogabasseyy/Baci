import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { RepairStatusLookup } from './repair-status-lookup';

interface RepairStatusPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ ticket?: string | string[] }>;
}

// Slug is validated BEFORE it reaches the `'use cache'` merchant lookups so
// bot-supplied garbage never pollutes the cache keys (repo slug-safety pattern).
async function getStatusMerchant(slug: string) {
  if (!isValidMerchantIdentifier(slug)) {
    return null;
  }
  const key = slug.toLowerCase();
  return isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(key)
    : await getCachedMerchant(key);
}

export async function generateMetadata({
  params,
}: RepairStatusPageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getStatusMerchant(slug);
  if (!merchant) {
    return { title: 'Store Not Found' };
  }

  return {
    title: buildStorefrontMetadataTitle({
      title: `Repair Status - ${merchant.business_name}`,
      fallback: 'Repair Status',
    }).metadataTitle,
    description: `Check the status of your repair with ${merchant.business_name} using your ticket number and email.`,
    robots: { index: false, follow: false },
  };
}

export default async function RepairStatusPage({
  params,
  searchParams,
}: RepairStatusPageProps) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : {};
  const initialTicket =
    typeof query.ticket === 'string' && /^\d{1,10}$/.test(query.ticket)
      ? query.ticket
      : undefined;
  const merchant = await getStatusMerchant(slug);
  if (!merchant) {
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="mb-3 font-bold text-3xl">Check your repair status</h1>
          <p className="text-store-background-text/70">
            Enter your ticket number and the email you used to book to see the
            latest on your repair with {merchant.business_name}.
          </p>
        </div>
        <div className="rounded-xl border border-store-border bg-store-background-text/5 p-6 shadow-sm">
          {/* Pass the URL slug straight through: the lookup route resolves it
              (subdomain or custom domain) exactly as this page did. */}
          <RepairStatusLookup
            initialTicket={initialTicket}
            slug={slug.toLowerCase()}
          />
        </div>
      </div>
    </div>
  );
}
