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

  return (
    <>
      <JsonLd data={breadcrumbSchema} />

      <main className="min-h-screen bg-[color-mix(in_srgb,var(--store-background)_94%,var(--store-background-text)_6%)] pb-20 pt-6">
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

          {/* Keep the initial and resumed intro identical to prevent reflow. */}
          {omitIntro ? null : <CompareHubIntro />}

          {sections.length === 0 ? (
            <section className="mt-10 rounded-3xl border border-store-background-text/10 bg-store-background px-6 py-16 text-center shadow-sm">
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
            <div className="mt-10 space-y-8">
              {sections.map((section) => (
                <section
                  key={section.categorySlug}
                  aria-labelledby={`${section.categorySlug}-compare-links`}
                  className="rounded-3xl border border-store-background-text/10 bg-store-background p-5 shadow-sm md:p-6"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2
                        id={`${section.categorySlug}-compare-links`}
                        className="text-xl font-semibold text-store-background-text"
                      >
                        {section.categoryName}
                      </h2>
                      <p className="mt-1 text-sm text-store-background-text/55">
                        {section.links.length} comparison paths
                      </p>
                    </div>
                    <Link
                      href={asRoute(`${pathPrefix}/${section.categorySlug}`)}
                      prefetch={false}
                      className="text-sm font-semibold text-store-primary underline-offset-4 hover:underline"
                    >
                      Shop {section.categoryName}
                    </Link>
                  </div>
                  <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {section.links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={asRoute(link.href)}
                          prefetch={false}
                          className="text-sm font-medium text-store-primary underline-offset-4 hover:underline"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
