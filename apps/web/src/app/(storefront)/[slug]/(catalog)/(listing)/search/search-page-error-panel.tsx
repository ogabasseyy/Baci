import Link from 'next/link';
import { asRoute } from '@/lib/routes';

interface SearchPageErrorPanelProps {
  allProductsHref: string;
  query: string;
  retryHref: string;
}

export function SearchPageErrorPanel({
  allProductsHref,
  query,
  retryHref,
}: SearchPageErrorPanelProps) {
  return (
    <div className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-store-background-text">
        Search is temporarily unavailable
      </h2>
      <p className="mt-2 text-sm text-store-background-text/55">
        We couldn&apos;t load results for “{query}”. Try again in a moment.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={asRoute(retryHref)}
          prefetch={false}
          className="rounded-md bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
        >
          Try again
        </Link>
        <Link
          href={asRoute(allProductsHref)}
          prefetch={false}
          className="rounded-md border border-store-background-text/15 px-4 py-2 text-sm font-semibold text-store-background-text transition hover:border-store-primary hover:text-store-primary"
        >
          View all products
        </Link>
      </div>
    </div>
  );
}
