import {
  getCanonicalBlogCategorySlug,
  getOgabasseyBlogCategoryAliasSlug,
} from '@/app/(storefront)/[slug]/(blog)/blog/blog-category-routing';

export type CrawlDepthUrlKind =
  | 'blog'
  | 'blog-category-alias-cleanup'
  | 'blog-pagination-cleanup'
  | 'broken-cleanup'
  | 'compare'
  | 'demo-cleanup'
  | 'listing-page'
  | 'product'
  | 'redirect-cleanup'
  | 'unparseable';

export interface ClassifiedCrawlDepthUrl {
  kind: CrawlDepthUrlKind;
  path: string;
  canonicalPath?: string;
}

interface ClusterSummary {
  coveredRows: number;
  missingRows: number;
  totalRows: number;
}

export interface CrawlDepthCoverageReport {
  cleanupRows: number;
  clusters: Record<string, ClusterSummary>;
  coveredMaintainedRows: number;
  missing: ClassifiedCrawlDepthUrl[];
  missingMaintainedRows: number;
  totalRows: number;
}

const CLEANUP_KINDS = new Set<CrawlDepthUrlKind>([
  'blog-category-alias-cleanup',
  'blog-pagination-cleanup',
  'broken-cleanup',
  'demo-cleanup',
  'redirect-cleanup',
]);

function pathWithSearch(url: URL) {
  return `${url.pathname}${url.search}`;
}

function compareClusterKey(path: string) {
  const match = path.match(/\/compare\/[^/]+-vs-([^/?#]+)/);
  return match ? `vs-${match[1]}` : null;
}

function listingPagePath(url: URL) {
  const params = new URLSearchParams();
  const page = url.searchParams.get('page');

  for (const [key, value] of url.searchParams.entries()) {
    if (key !== 'page') {
      params.append(key, value);
    }
  }

  if (page) {
    params.set('page', page);
  }

  return `${url.pathname}?${params.toString()}`;
}

export function classifyCrawlDepthUrl(url: string): ClassifiedCrawlDepthUrl {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return { kind: 'unparseable', path: url.trim() || '(blank)' };
  }

  if (parsedUrl.hostname !== 'ogabassey.com') {
    return { kind: 'redirect-cleanup', path: parsedUrl.pathname || '/' };
  }

  if (parsedUrl.pathname.startsWith('/categories/')) {
    return { kind: 'broken-cleanup', path: parsedUrl.pathname };
  }

  if (parsedUrl.pathname === '/products/demo') {
    return { kind: 'demo-cleanup', path: parsedUrl.pathname };
  }

  if (
    parsedUrl.pathname === '/blog' &&
    (parsedUrl.searchParams.has('category') ||
      parsedUrl.searchParams.has('page'))
  ) {
    const params = new URLSearchParams();
    const category = parsedUrl.searchParams.get('category');
    const page = parsedUrl.searchParams.get('page');

    if (category) {
      params.set('category', category);
    }

    if (page) {
      params.set('page', page);
    }

    return {
      kind: 'blog-pagination-cleanup',
      path: `${parsedUrl.pathname}?${params.toString()}`,
    };
  }

  const blogCategoryMatch = parsedUrl.pathname.match(
    /^\/blog\/category\/([^/]+)$/
  );

  if (blogCategoryMatch) {
    let categorySlug: string;

    try {
      categorySlug = decodeURIComponent(blogCategoryMatch[1]);
    } catch {
      return { kind: 'unparseable', path: parsedUrl.pathname };
    }

    const canonicalSlug =
      getOgabasseyBlogCategoryAliasSlug(categorySlug) ??
      getCanonicalBlogCategorySlug(categorySlug);

    if (canonicalSlug !== categorySlug) {
      return {
        canonicalPath: `/blog/category/${canonicalSlug}`,
        kind: 'blog-category-alias-cleanup',
        path: parsedUrl.pathname,
      };
    }
  }

  if (parsedUrl.pathname.startsWith('/blog/')) {
    return { kind: 'blog', path: parsedUrl.pathname };
  }

  if (
    parsedUrl.pathname.endsWith('/compare') ||
    parsedUrl.pathname.includes('/compare/')
  ) {
    return { kind: 'compare', path: parsedUrl.pathname };
  }

  if (parsedUrl.searchParams.has('page')) {
    return {
      kind: 'listing-page',
      path: listingPagePath(parsedUrl),
    };
  }

  return { kind: 'product', path: pathWithSearch(parsedUrl) };
}

const STOREFRONT_ORIGIN = 'https://ogabassey.com';

function normalizeHref(href: string): string | null {
  try {
    const url = new URL(href, STOREFRONT_ORIGIN);
    if (
      !href.trim() ||
      url.origin !== STOREFRONT_ORIGIN ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return pathWithSearch(url);
  } catch {
    return null;
  }
}

export function isCoveredByMaintainedModules(
  classifiedUrl: ClassifiedCrawlDepthUrl,
  moduleHrefs: Set<string>
) {
  if (CLEANUP_KINDS.has(classifiedUrl.kind)) return true;
  if (classifiedUrl.kind === 'unparseable') return false;
  const normalized = normalizeHref(classifiedUrl.path);
  return normalized !== null && moduleHrefs.has(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectHrefs(value: unknown, hrefs: Set<string>) {
  if (typeof value === 'string') {
    const href = normalizeHref(value);
    if (href !== null) hrefs.add(href);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHrefs(item, hrefs);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.href === 'string') collectHrefs(value.href, hrefs);
  for (const nestedValue of Object.values(value)) {
    if (typeof nestedValue === 'object' && nestedValue !== null) {
      collectHrefs(nestedValue, hrefs);
    }
  }
}

export function collectModuleHrefs(value: unknown) {
  const hrefs = new Set<string>();
  collectHrefs(value, hrefs);
  return hrefs;
}

function emptyClusterSummary(): ClusterSummary {
  return {
    coveredRows: 0,
    missingRows: 0,
    totalRows: 0,
  };
}

export function buildCrawlDepthCoverageReport(
  urls: string[],
  moduleHrefs: Set<string>
): CrawlDepthCoverageReport {
  const clusters: Record<string, ClusterSummary> = {};
  const report: CrawlDepthCoverageReport = {
    cleanupRows: 0,
    clusters,
    coveredMaintainedRows: 0,
    missing: [],
    missingMaintainedRows: 0,
    totalRows: urls.length,
  };

  for (const url of urls) {
    const classifiedUrl = classifyCrawlDepthUrl(url);
    const isCleanup = CLEANUP_KINDS.has(classifiedUrl.kind);
    const covered = isCoveredByMaintainedModules(classifiedUrl, moduleHrefs);

    if (isCleanup) {
      report.cleanupRows += 1;
    } else if (covered) {
      report.coveredMaintainedRows += 1;
    } else {
      report.missingMaintainedRows += 1;
      report.missing.push(classifiedUrl);
    }

    const cluster =
      classifiedUrl.kind === 'compare'
        ? compareClusterKey(classifiedUrl.path)
        : null;

    if (cluster) {
      clusters[cluster] ??= emptyClusterSummary();
      clusters[cluster].totalRows += 1;

      if (covered) {
        clusters[cluster].coveredRows += 1;
      } else {
        clusters[cluster].missingRows += 1;
      }
    }
  }

  return report;
}

export function formatCrawlDepthCoverageReport(
  report: CrawlDepthCoverageReport
) {
  const lines = [
    'module_inventory_coverage (not live crawl or reachability evidence)',
    `total_rows ${report.totalRows}`,
    `covered_maintained_rows ${report.coveredMaintainedRows}`,
    `missing_maintained_rows ${report.missingMaintainedRows}`,
    `cleanup_rows ${report.cleanupRows}`,
  ];

  for (const [cluster, summary] of Object.entries(report.clusters)) {
    lines.push(
      `cluster ${cluster} covered_representative ${
        summary.totalRows > 0 && summary.missingRows === 0
      } covered_rows ${summary.coveredRows} total_rows ${summary.totalRows}`
    );
  }

  if (report.missing.length > 0) {
    lines.push('missing_samples');
    for (const missingUrl of report.missing.slice(0, 20)) {
      lines.push(`${missingUrl.kind} ${missingUrl.path}`);
    }
  }

  return lines.join('\n');
}
