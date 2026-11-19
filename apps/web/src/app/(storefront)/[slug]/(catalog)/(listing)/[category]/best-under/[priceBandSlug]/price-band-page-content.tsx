import { notFound } from 'next/navigation';
import type { BreadcrumbList, ItemList } from 'schema-dts';
import { ProductIndexCard } from '@/app/(storefront)/[slug]/(catalog)/(listing)/products/product-index-card';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { buildPriceBandPageSchemas } from '@/lib/storefront-compare/compare-schema';
import { loadPriceBandPage } from '@/lib/storefront-compare/load-price-band-page';

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

function toProductIndexCardModel(
  product: LoadedPriceBandPage['products'][number]
): NormalizedProduct {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    image: product.image,
    imageLarge: product.image,
    images: product.image ? [product.image] : [],
    category: product.category,
    category_slug: product.category_slug,
    brand: product.brand ?? null,
    price: product.price,
    compare_at_price: null,
    condition: product.condition,
    stock: product.stock,
    manage_stock: product.manage_stock,
    rating: 0,
    availability: product.availability,
    product_key_specs: product.product_key_specs ?? null,
    has_condition_offers: product.has_condition_offers,
    available_conditions: [],
    variant_model: 'legacy',
  };
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

          <h2 className="sr-only">Matching products</h2>
          <ul className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {page.products.map((product) => (
              <li key={product.id}>
                <ProductIndexCard
                  formattedPrice={formatProductPrice(product.price)}
                  pathPrefix={page.pathPrefix}
                  product={toProductIndexCardModel(product)}
                />
              </li>
            ))}
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
