import { buildProductSearchQuery } from '@baci/shared/lib';
import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import { ProductRequest } from './product-request';

interface SearchPageNoResultsPanelProps {
  allProductsHref: string;
  contactHref: string;
  searchQuery: string;
  hasActiveRefinements?: boolean;
  merchantSlug?: string;
}

export function SearchPageNoResultsPanel({
  allProductsHref,
  contactHref,
  searchQuery,
  hasActiveRefinements = false,
  merchantSlug,
}: SearchPageNoResultsPanelProps) {
  // Normalization-empty queries (e.g. "?q=!!") survive sanitization but
  // carry no catalog term, and the intake schema rejects them for lacking
  // a letter or number — so the request form would only ever 400. Hide it
  // with the same normalization native search and intake use.
  const hasSearchableQuery =
    buildProductSearchQuery(searchQuery).normalized !== '';
  return (
    <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-store-background-text">
        No products found
      </h2>
      <p className="mt-2 text-sm text-store-background-text/55">
        We could not find any products matching “{searchQuery}”.
      </p>
      {merchantSlug && !hasActiveRefinements && hasSearchableQuery && (
        <ProductRequest
          key={searchQuery}
          query={searchQuery}
          merchantSlug={merchantSlug}
        />
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={asRoute(allProductsHref)}
          prefetch={false}
          className="rounded-md bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
        >
          View all products
        </Link>
        <Link
          href={asRoute(contactHref)}
          prefetch={false}
          className="rounded-md border border-store-background-text/15 px-4 py-2 text-sm font-semibold text-store-background-text transition hover:border-store-primary hover:text-store-primary"
        >
          Contact support
        </Link>
      </div>
    </div>
  );
}
