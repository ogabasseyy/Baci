import {
  getStorefrontCrawlDiscoveryPages,
  STOREFRONT_CRAWL_DISCOVERY_BLOG_PAGE_LIMIT,
  STOREFRONT_CRAWL_DISCOVERY_OVERFLOW_MAX_LINKS,
} from '@/lib/storefront-pagination';

interface BlogCrawlDiscoveryLinksProps {
  buildHref: (page: number) => string;
  currentPage: number;
  label: string;
  pageLabel: string;
  totalPages: number;
  allPagesThreshold?: number;
  className?: string;
  maxLinks?: number;
}

export function BlogCrawlDiscoveryLinks({
  buildHref,
  currentPage,
  label,
  pageLabel,
  totalPages,
  allPagesThreshold = STOREFRONT_CRAWL_DISCOVERY_BLOG_PAGE_LIMIT,
  className = 'w-full border-t border-border/70 pt-4 text-center',
  maxLinks = STOREFRONT_CRAWL_DISCOVERY_OVERFLOW_MAX_LINKS,
}: BlogCrawlDiscoveryLinksProps) {
  const pages = getStorefrontCrawlDiscoveryPages({
    totalPages,
    currentPage,
    allPagesThreshold,
    maxPages: maxLinks,
  });

  if (pages.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-2">
        {pages.map((page) => (
          <a
            key={page}
            href={buildHref(page)}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            {pageLabel} {page}
          </a>
        ))}
      </div>
    </div>
  );
}
