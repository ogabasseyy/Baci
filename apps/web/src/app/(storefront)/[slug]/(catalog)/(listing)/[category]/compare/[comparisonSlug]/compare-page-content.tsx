import { headers } from 'next/headers';
import type { BreadcrumbList, FAQPage, ItemList } from 'schema-dts';
import { StorefrontRouteNotFoundContent } from '@/app/(storefront)/[slug]/storefront-route-not-found-content';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import {
  buildComparePageSchemas,
  buildProductCompareItemListSchema,
} from '@/lib/storefront-compare/compare-schema';
import { loadComparePage } from '@/lib/storefront-compare/load-compare-page';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { isDomainIdentifier } from '@/lib/validation';
import { CompareRelatedLinks } from './compare-related-links';
import {
  type ProductCompareSchemaProduct,
  toProductCompareSchemaProduct,
} from './compare-schema-product';

interface ComparePageContentProps {
  params: Promise<{
    slug: string;
    category: string;
    comparisonSlug: string;
  }>;
}

function getComparisonColumnLabels(
  page: Awaited<ReturnType<typeof loadComparePage>>
): [string, string] {
  if (!page) {
    return ['Left', 'Right'];
  }

  if (page.kind === 'product' && page.leftProduct && page.rightProduct) {
    return [page.leftProduct.name, page.rightProduct.name];
  }

  if (page.kind === 'brand') {
    return [page.leftBrand, page.rightBrand];
  }

  return ['Left', 'Right'];
}

function getComparisonRowGroups(
  page: NonNullable<Awaited<ReturnType<typeof loadComparePage>>>
) {
  if (page.kind === 'product') {
    return page.comparisonMatrix.groups.map((group) => ({
      category: group.category,
      rows: group.rows.map((row) => ({
        label: row.label,
        leftValue: row.values[0] || '—',
        rightValue: row.values[1] || '—',
      })),
    }));
  }

  return [{ category: 'Overview', rows: page.comparisonRows }];
}

export async function ComparePageContent({ params }: ComparePageContentProps) {
  const resolvedParams = await params;
  const page = await loadComparePage({
    merchantSlug: resolvedParams.slug,
    categorySlug: resolvedParams.category,
    comparisonSlug: resolvedParams.comparisonSlug,
  });

  if (!page || (!page.isIndexable && !page.isLegacyFallback)) {
    // Missing compare pairs are route data, not render failures. Keep this
    // response marker-free after the storefront PPR boundary has streamed.
    const routePrefix = getStorefrontPathPrefix(
      await headers(),
      resolvedParams.slug
    );
    return (
      <StorefrontRouteNotFoundContent
        backHref={
          isDomainIdentifier(resolvedParams.slug) || routePrefix === ''
            ? '/'
            : `/${resolvedParams.slug}`
        }
        message="This comparison is unavailable or has moved."
        title="Comparison not found"
      />
    );
  }

  const schemas = buildComparePageSchemas({
    breadcrumbItems: page.breadcrumbItems,
    faqItems: page.faqItems,
  });
  const productSchemaProducts =
    page.kind === 'product'
      ? [page.leftProduct, page.rightProduct]
          .map((product) =>
            toProductCompareSchemaProduct(product, page.canonicalUrl)
          )
          .filter(
            (product): product is ProductCompareSchemaProduct =>
              product !== null
          )
      : [];
  const itemListSchema =
    page.kind === 'product' && productSchemaProducts.length === 2
      ? buildProductCompareItemListSchema({
          pageName: page.heading,
          pageUrl: page.canonicalUrl,
          currency: resolveMerchantCurrencyConfig(page.merchant).code,
          products: productSchemaProducts,
          comparisonMatrix: page.comparisonMatrix,
        })
      : null;
  const [leftColumnLabel, rightColumnLabel] = getComparisonColumnLabels(page);
  const comparisonRowGroups = getComparisonRowGroups(page);

  return (
    <>
      <JsonLd
        data={schemas.breadcrumb as unknown as JsonLdData<BreadcrumbList>}
      />
      {schemas.faq && (
        <JsonLd data={schemas.faq as unknown as JsonLdData<FAQPage>} />
      )}
      {itemListSchema && (
        <JsonLd data={itemListSchema as unknown as JsonLdData<ItemList>} />
      )}
      {/*
        Multi-tenant theming: this route is shared across all merchants, so it
        uses the merchant-scoped store tokens (var(--store-background) etc.) — NOT
        the global shadcn tokens — and establishes its own light surface so the
        content is readable on the dark storefront shell (matching the PDP).
      */}
      <div className="min-h-[70vh] bg-store-background text-store-background-text">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="space-y-4">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {page.heading}
            </h1>
            <p className="max-w-3xl text-base text-store-background-text/70 sm:text-lg">
              {page.summaryVerdict}
            </p>
          </header>

          <section className="mt-8">
            <h2 className="text-xl font-semibold">Key Differences</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-store-background-text/70 sm:text-base">
              {page.keyDifferences.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="mt-8 rounded-2xl border border-store-border bg-store-background-text/5 p-5">
            <h2 className="text-xl font-semibold">
              How to use this comparison
            </h2>
            <div className="mt-3 space-y-3 text-sm text-store-background-text/70 sm:text-base">
              <p>
                Check the verdict first, then review the differences and table
                rows for {leftColumnLabel} and {rightColumnLabel}. Prioritize
                the specs, price range, condition, warranty and delivery details
                that affect how you plan to use this product category.
              </p>
              <p>
                Before checkout, confirm live availability, selected variant,
                regional compatibility and included accessories on the product
                page. Similar model names can hide different storage, platform,
                display or bundle details, so use the table as a shortlist
                before opening the final product listing.
              </p>
            </div>
          </section>

          <section className="mt-10 overflow-x-auto rounded-2xl border border-store-border bg-store-background shadow-sm">
            <table
              aria-label="Product comparison table"
              className="min-w-full border-collapse text-left"
            >
              <thead className="bg-store-background-text/10">
                <tr>
                  <th className="px-4 py-3 text-sm font-semibold text-store-background-text">
                    Spec
                  </th>
                  <th className="px-4 py-3 text-sm font-semibold text-store-background-text">
                    {leftColumnLabel}
                  </th>
                  <th className="px-4 py-3 text-sm font-semibold text-store-background-text">
                    {rightColumnLabel}
                  </th>
                </tr>
              </thead>
              {comparisonRowGroups.map((group) => (
                <tbody key={group.category}>
                  <tr className="border-t border-store-background-text/10 align-top">
                    <th
                      scope="rowgroup"
                      colSpan={3}
                      className="bg-store-background-text/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-store-background-text/70"
                    >
                      {group.category}
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr
                      key={`${group.category}-${row.label}`}
                      className="border-t border-store-background-text/10 align-top"
                    >
                      <th
                        scope="row"
                        className="px-4 py-3 text-sm font-medium text-store-background-text"
                      >
                        {row.label}
                      </th>
                      <td className="px-4 py-3 text-sm text-store-background-text/70">
                        {row.leftValue}
                      </td>
                      <td className="px-4 py-3 text-sm text-store-background-text/70">
                        {row.rightValue}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </section>

          {page.faqItems.length > 0 && (
            <section className="mt-10 space-y-4">
              <h2 className="text-2xl font-semibold">Buyer FAQ</h2>
              <div className="space-y-4">
                {page.faqItems.map((item) => (
                  <article
                    key={item.question}
                    className="rounded-2xl border border-store-border p-4"
                  >
                    <h3 className="text-base font-medium text-store-background-text">
                      {item.question}
                    </h3>
                    <p className="mt-2 text-sm text-store-background-text/70">
                      {item.answer}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {page.guideLinks.length > 0 && (
            <section className="mt-10 space-y-4">
              <h2 className="text-2xl font-semibold">
                Buyer guides and support articles
              </h2>
              <ul className="space-y-4">
                {page.guideLinks.map((link) => (
                  <li
                    key={link.href}
                    className="space-y-1 rounded-2xl border border-store-border p-4"
                  >
                    <a
                      href={link.href}
                      className="text-base font-semibold text-store-primary underline-offset-4 hover:underline"
                    >
                      {link.title}
                    </a>
                    <p className="text-sm text-store-background-text/70">
                      {link.description}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {page.relatedCompareLinks.length > 0 ? (
            <CompareRelatedLinks
              links={page.relatedCompareLinks}
              storeUrl={page.breadcrumbItems[0]?.url ?? page.canonicalUrl}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
