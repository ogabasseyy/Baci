import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface SearchPageNoResultsPanelProps {
  allProductsHref: string;
  contactHref: string;
  searchQuery: string;
}

export function SearchPageNoResultsPanel({
  allProductsHref,
  contactHref,
  searchQuery,
}: SearchPageNoResultsPanelProps) {
  return (
    <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-store-background-text">
        No products found
      </h2>
      <p className="mt-2 text-sm text-store-background-text/55">
        We could not find any products matching “{searchQuery}”.
      </p>
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
