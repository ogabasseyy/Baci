import Link from 'next/link';
import { asRoute } from '@/lib/routes';

export function SearchPageBreadcrumb({ pathPrefix }: { pathPrefix: string }) {
  return (
    <nav className="flex items-center gap-2 text-sm text-store-background-text/55">
      <Link
        href={asRoute(pathPrefix || '/')}
        prefetch={false}
        className="transition-colors hover:text-store-primary"
      >
        Home
      </Link>
      <span aria-hidden="true">/</span>
      <span className="font-medium text-store-background-text">Search</span>
    </nav>
  );
}
