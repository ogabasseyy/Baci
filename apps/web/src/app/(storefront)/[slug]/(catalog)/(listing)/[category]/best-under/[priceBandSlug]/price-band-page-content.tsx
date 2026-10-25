import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { BreadcrumbList, ItemList } from 'schema-dts';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { getProductUrl } from '@/lib/seo-utils';
import { buildPriceBandPageSchemas } from '@/lib/storefront-compare/compare-schema';
import { loadPriceBandPage } from '@/lib/storefront-compare/load-price-band-page';
import { buildStorefrontVariantUrl } from '@/lib/storefront-variant-disclosure';

type LoadedPriceBandPage = NonNullable<
  Awaited<ReturnType<typeof loadPriceBandPage>>
>;

interface PriceBandPageContentProps {
  page?: LoadedPriceBandPage | null;
  params?: Promise<{
    slug: string;
    category: string;
    priceBandSlug: string;
  }>;
}

export async function PriceBandPageContent({
  page: preloadedPage,
  params,
}: PriceBandPageContentProps) {
  let page = preloadedPage;
  if (!page && params) {
    const resolvedParams = await params;
    page = await loadPriceBandPage({
      merchantSlug: resolvedParams.slug,
      categorySlug: resolvedParams.category,
      priceBandSlug: resolvedParams.priceBandSlug,
    });
  }

  if (!page?.isIndexable) {
    notFound();
  }

  const formatProductPrice = (amount: number) =>
    formatDisplayCurrency(amount, page.payoutCurrency, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  const schemas = buildPriceBandPageSchemas({
    breadcrumbItems: page.breadcrumbItems,
    pageName: page.heading,
    pageUrl: page.canonicalUrl,
    currency: page.payoutCurrency,
    products: page.products,
  });

  return (
    <>
      <JsonLd
        data={schemas.breadcrumb as unknown as JsonLdData<BreadcrumbList>}
      />
      <JsonLd data={schemas.itemList as unknown as JsonLdData<ItemList>} />
      {/*
        Multi-tenant theming: this route is shared across all merchants, so it
        uses the merchant-scoped store tokens (var(--store-background) etc.) — NOT
        the global shadcn tokens — and establishes its own light surface so the
        content is readable on the dark storefront shell (matching the PDP).
      */}
      <div className="min-h-[70vh] bg-store-background text-store-background-text">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {page.heading}
            </h1>
            <p className="max-w-3xl text-base text-store-background-text/70 sm:text-lg">
              {page.intro}
            </p>
          </header>

          <section
            className="mt-8 max-w-3xl space-y-3"
            aria-labelledby="budget-methodology"
          >
            <h2 id="budget-methodology" className="text-xl font-semibold">
              How to use this budget comparison
            </h2>
            <p>
              Sorted by price, lowest first, with one eligible priced option per
              model. The ceiling is exclusive. Tracked options with no stock,
              explicitly classified feature phones in smartphone guides, and
              Wi-Fi-only phone options are excluded. These are catalog
              comparisons, not hands-on reviews or performance rankings.
            </p>
            <p>
              In stock means the selected option has tracked availability.
              Available to order means inventory is not tracked; confirm
              fulfillment, delivery, accessories and warranty before payment.
              Prices and availability can change.
            </p>
            <p>
              For the lowest listed item price, start at the top. Delivery and
              other checkout charges are separate. Tradeoffs include the listed
              condition and configuration: a lower price does not establish
              better battery health, camera quality or suitability for demanding
              workloads. Compare those details on the selected product page.
            </p>
            <a
              href={page.breadcrumbItems[1]?.url}
              className="text-store-primary underline"
            >
              Browse the full category
            </a>
          </section>
          <h2 className="mt-8 text-2xl font-semibold">
            Eligible priced options
          </h2>
          <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {page.products.map((product) => {
              const baseUrl = new URL(
                `${page.pathPrefix}${getProductUrl(product)}`,
                page.canonicalUrl
              ).toString();
              const href = product.variantId
                ? buildStorefrontVariantUrl(baseUrl, { id: product.variantId })
                : baseUrl;
              return (
                <li
                  key={product.id}
                  className="overflow-hidden rounded-2xl border border-store-border"
                >
                  <a href={href} className="block h-full p-4">
                    <div className="relative aspect-square">
                      <Image
                        src={product.image}
                        alt={product.name}
                        fill
                        sizes="(max-width: 768px) 50vw, 25vw"
                        className="object-contain"
                      />
                    </div>
                    <h3 className="mt-3 text-base font-semibold">
                      {product.name}
                    </h3>
                    <p className="mt-2 font-bold">
                      {formatProductPrice(product.price)}
                    </p>
                    <p className="mt-1 text-sm">
                      Condition: {product.condition}
                    </p>
                    <p className="mt-1 text-sm">{product.availabilityLabel}</p>
                    <p className="mt-2 text-sm text-store-primary">
                      View this configuration
                    </p>
                  </a>
                </li>
              );
            })}
          </ul>

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
        </div>
      </div>
    </>
  );
}
