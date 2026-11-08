import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import { BlogCrawlDiscoveryLinks } from '../../blog-crawl-discovery-links';

interface BlogAuthorPaginationProps {
  authorName: string;
  buildHref: (page: number) => string;
  currentPage: number;
  totalPages: number;
}

export function BlogAuthorPagination({
  authorName,
  buildHref,
  currentPage,
  totalPages,
}: BlogAuthorPaginationProps) {
  const safeTotalPages =
    Number.isInteger(totalPages) && totalPages > 0 ? totalPages : 0;
  const safeCurrentPage =
    Number.isInteger(currentPage) && currentPage > 0
      ? Math.min(currentPage, safeTotalPages || 1)
      : 1;

  if (safeTotalPages <= 1) {
    return null;
  }

  return (
    <nav aria-label="Author articles pagination" className="mt-8 space-y-4">
      <div className="flex items-center justify-between gap-4">
        {safeCurrentPage > 1 ? (
          <Link
            href={asRoute(buildHref(safeCurrentPage - 1))}
            rel="prev"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-sm text-muted-foreground">
          Page {safeCurrentPage} of {safeTotalPages}
        </span>
        {safeCurrentPage < safeTotalPages ? (
          <Link
            href={asRoute(buildHref(safeCurrentPage + 1))}
            rel="next"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Next
          </Link>
        ) : (
          <span />
        )}
      </div>

      <BlogCrawlDiscoveryLinks
        buildHref={buildHref}
        className="border-t border-border/70 pt-4 text-center"
        currentPage={safeCurrentPage}
        label={`Browse ${authorName} article pages`}
        pageLabel={`${authorName} articles page`}
        totalPages={safeTotalPages}
      />
    </nav>
  );
}
