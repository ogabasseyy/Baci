import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BreadcrumbList } from 'schema-dts';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import {
  getCachedCategoryPageData,
  getRequestScopedMerchant,
  getStorefrontCategories,
} from '@/lib/cached-data';
import { asRoute } from '@/lib/routes';
import { generateBreadcrumbSchema } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { CompareHubIntro } from './compare-hub-intro';
import {
  buildCompareIndexSections,
  COMPARE_HUB_PAGE_CATEGORY_LIMIT,
  COMPARE_HUB_PAGE_LINKS_PER_CATEGORY_LIMIT,
  COMPARE_HUB_PAGE_PRODUCTS_PER_CATEGORY_LIMIT,
  COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT,
} from './compare-index-discovery';

interface ComparePageContentProps {
  params: Promise<{ slug: string }>;
  /** Set when the parent already committed the hub LCP intro. */
  omitIntro?: boolean;
}

export async function ComparePageContent({
  omitIntro = false,
  params,
}: ComparePageContentProps) {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const headersList = await headers();
  const { categories, queryFailed } = await getStorefrontCategories(
    merchant.id
  );
  const storeUrl = buildStoreUrl(merchant);
  const pathPrefix = getStorefrontPathPrefix(headersList, merchant);
  const storefrontName = merchant.business_name?.trim();
  const sections = await buildCompareIndexSections({
    categories,
    categoryLimit: COMPARE_HUB_PAGE_CATEGORY_LIMIT,
    getCategoryPageData: (categorySlug, productOffset, productLimit) =>
      getCachedCategoryPageData(
        merchant.id,
        categorySlug,
        merchant.slug,
        productOffset,
        productLimit
      ),
    linksPerCategoryLimit: COMPARE_HUB_PAGE_LINKS_PER_CATEGORY_LIMIT,
    pathPrefix,
    productLimit: COMPARE_HUB_PAGE_PRODUCTS_PER_CATEGORY_LIMIT,
    storeUrl,
    totalLinkLimit: COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT,
  });
  const canonicalUrl = `${storeUrl}/compare`;
  const breadcrumbSchema: JsonLdData<BreadcrumbList> = generateBreadcrumbSchema(
    [
      { name: storefrontName || 'Store', url: storeUrl },
      { name: 'Compare products', url: canonicalUrl },
    ]
  );

  const sectionsBody =
    sections.length === 0 ? (
      <section className="mt-8 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-xs">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
          <span aria-hidden="true" className="text-xl font-bold">
            ⇌
          </span>
        </div>
        <h2 className="text-xl font-semibold text-store-background-text">
          {queryFailed
            ? 'Product comparisons temporarily unavailable'
            : 'No product comparisons available'}
        </h2>
        <p className="mt-2 text-sm text-store-background-text/55">
          {queryFailed
            ? 'Please try again shortly while category navigation recovers.'
            : 'Comparison pages will appear here once enough product details are available.'}
        </p>
      </section>
    ) : (
      <div className="mt-6 space-y-8">
        {sections.length > 1 && (
          <nav
            aria-label="Compare categories"
            className="flex flex-wrap items-center gap-2 pt-1"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-store-background-text/50">
              Jump to:
            </span>
            {sections.map((section) => (
              <a
                key={section.categorySlug}
                href={`#${section.categorySlug}-section`}
                className="inline-flex items-center rounded-full border border-store-background-text/10 bg-store-background px-3 py-1 text-xs font-medium text-store-background-text/80 transition-colors hover:border-store-primary hover:text-store-primary"
              >
                {section.categoryName} ({section.links.length})
              </a>
            ))}
          </nav>
        )}

        {sections.map((section) => (
          <section
            key={section.categorySlug}
            id={`${section.categorySlug}-section`}
            aria-labelledby={`${section.categorySlug}-compare-links`}
            className="rounded-3xl border border-store-background-text/10 bg-store-background p-5 shadow-xs transition-shadow hover:shadow-sm md:p-6"
          >
            <div className="flex flex-col gap-2 border-b border-store-background-text/5 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2
                    id={`${section.categorySlug}-compare-links`}
                    className="text-xl font-bold tracking-tight text-store-background-text md:text-2xl"
                  >
                    {section.categoryName}
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-store-primary/10 px-2.5 py-0.5 text-xs font-semibold text-store-primary">
                    {section.links.length}{' '}
                    {section.links.length === 1 ? 'path' : 'paths'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-store-background-text/60">
                  Side-by-side spec and value comparisons across{' '}
                  {section.categoryName.toLowerCase()}
                </p>
              </div>
              <Link
                href={asRoute(`${pathPrefix}/${section.categorySlug}`)}
                prefetch={false}
                className="inline-flex items-center gap-1 text-sm font-semibold text-store-primary underline-offset-4 transition-colors hover:underline"
              >
                <span>Shop {section.categoryName}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={asRoute(link.href)}
                    prefetch={false}
                    aria-label={link.label}
                    className="group flex h-full flex-col justify-between rounded-2xl border border-store-background-text/10 bg-store-background p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-store-primary/50 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-semibold text-store-background-text transition-colors group-hover:text-store-primary">
                        {link.label}
                      </span>
                      <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-store-primary/10 px-2 py-0.5 text-[11px] font-bold text-store-primary">
                        VS
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-store-background-text/5 pt-2.5 text-xs text-store-background-text/60">
                      <span className="font-medium text-store-primary group-hover:underline">
                        Compare specs →
                      </span>
                      <span className="text-[11px] text-store-background-text/40">
                        Side-by-side
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );

  if (omitIntro) {
    return (
      <>
        <JsonLd data={breadcrumbSchema} />
        {sectionsBody}
      </>
    );
  }

  return (
    <>
      <JsonLd data={breadcrumbSchema} />

      <div className="bg-[color-mix(in_srgb,var(--store-background)_94%,var(--store-background-text)_6%)] pb-20 pt-6">
        <div className="mx-auto max-w-[1400px] px-4 md:px-6">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-sm text-store-background-text/55"
          >
            <Link
              href={asRoute(pathPrefix || '/')}
              prefetch={false}
              className="transition-colors hover:text-store-primary"
            >
              Home
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-store-background-text">
              Compare products
            </span>
          </nav>

          <CompareHubIntro />

          {sectionsBody}
        </div>
      </div>
    </>
  );
}
