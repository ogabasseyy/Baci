import type { BreadcrumbList, ItemList } from 'schema-dts';
import { ProductIndexCard } from '@/app/(storefront)/[slug]/(catalog)/(listing)/products/product-index-card';
import { JsonLd, type JsonLdData } from '@/components/seo/json-ld';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import type { brandAuthorityPageLoader } from '@/lib/storefront-category/load-brand-authority-page';
import { buildPriceBandPageSchemas } from '@/lib/storefront-compare/compare-schema';

type LoadedBrandAuthorityPage = NonNullable<
  Awaited<ReturnType<typeof brandAuthorityPageLoader.load>>
>;

export type BrandAuthorityPageContentModel = Pick<
  LoadedBrandAuthorityPage,
  | 'breadcrumbItems'
  | 'canonicalUrl'
  | 'categoryName'
  | 'categoryUrl'
  | 'guideLinks'
  | 'heading'
  | 'intro'
  | 'pathPrefix'
  | 'products'
> & {
  brand: Pick<LoadedBrandAuthorityPage['brand'], 'displayName'>;
  merchant: Pick<
    LoadedBrandAuthorityPage['merchant'],
    'country' | 'payout_currency'
  >;
  familyLinks?: Array<{
    href: string;
    label: string;
    productCount: number;
  }>;
};

interface BrandAuthorityPageContentProps {
  page: BrandAuthorityPageContentModel;
}

function toProductIndexCardModel(
  product: BrandAuthorityPageContentModel['products'][number]
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
    brand: product.brand,
    price: product.price,
    compare_at_price: null,
    condition: product.condition,
    stock: product.stock,
    rating: 0,
    availability: product.availability,
    product_key_specs: product.product_key_specs ?? null,
    has_condition_offers: product.has_condition_offers,
    available_conditions: [],
    variant_model: 'legacy',
  };
}

export function BrandAuthorityPageContent({
  page,
}: BrandAuthorityPageContentProps) {
  const currency = resolveMerchantCurrencyConfig(page.merchant).code;
  const schemas = buildPriceBandPageSchemas({
    breadcrumbItems: page.breadcrumbItems,
    pageName: page.heading,
    pageUrl: page.canonicalUrl,
    currency,
    products: page.products,
  });

  return (
    <>
      <JsonLd
        data={schemas.breadcrumb as unknown as JsonLdData<BreadcrumbList>}
      />
      <JsonLd data={schemas.itemList as unknown as JsonLdData<ItemList>} />
      <main className="min-h-[70vh] bg-store-background text-store-background-text">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <header className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-wide text-store-primary">
              {page.categoryName}
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {page.heading}
            </h1>
            <p
              className="max-w-3xl text-base leading-7 text-store-background-text/70 sm:text-lg"
              data-cwv-lcp-copy="authority-hub"
            >
              {page.intro}
            </p>
            <a
              href={page.categoryUrl}
              className="inline-flex text-sm font-semibold text-store-primary underline-offset-4 hover:underline"
            >
              Browse all {page.categoryName.toLowerCase()}
            </a>
          </header>

          {page.familyLinks && page.familyLinks.length > 0 ? (
            <nav aria-labelledby="model-families" className="mt-8">
              <h2 id="model-families" className="text-xl font-semibold">
                Shop by model family
              </h2>
              <ul className="mt-4 flex flex-wrap gap-3">
                {page.familyLinks.map((family) => (
                  <li key={family.href}>
                    <a
                      href={family.href}
                      className="inline-flex rounded-full border border-store-border px-4 py-2 text-sm font-semibold text-store-primary underline-offset-4 hover:underline"
                    >
                      {family.label} ({family.productCount})
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <section aria-labelledby="available-models" className="mt-10">
            <h2 id="available-models" className="text-2xl font-semibold">
              Available {page.brand.displayName} models
            </h2>
            {page.products.length > 0 ? (
              <ul className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {page.products.map((product) => (
                  <li key={product.id}>
                    <ProductIndexCard
                      formattedPrice={formatDisplayCurrency(
                        product.price,
                        currency,
                        {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        }
                      )}
                      pathPrefix={page.pathPrefix}
                      product={toProductIndexCardModel(product)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-store-background-text/70">
                No {page.brand.displayName} models are currently available.
              </p>
            )}
          </section>

          {page.guideLinks.length > 0 ? (
            <section aria-labelledby="brand-guides" className="mt-12 space-y-4">
              <h2 id="brand-guides" className="text-2xl font-semibold">
                {page.brand.displayName} buying guides
              </h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {page.guideLinks.map((link) => (
                  <li
                    key={link.href}
                    className="space-y-1 rounded-2xl border border-store-border p-4"
                  >
                    <a
                      href={link.href}
                      className="font-semibold text-store-primary underline-offset-4 hover:underline"
                    >
                      {link.title}
                    </a>
                    <p className="text-sm leading-6 text-store-background-text/70">
                      {link.description}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </main>
    </>
  );
}
