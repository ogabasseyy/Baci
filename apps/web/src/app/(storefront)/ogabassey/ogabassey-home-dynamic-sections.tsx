import { selectLaunchProducts } from '@baci/shared/storefront';
import Link from 'next/link';
import { mapHomeProductsToTemplateProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-product-adapter';
import { JsonLd } from '@/components/seo/json-ld';
import { OGABASSEY_HOME_SCHEMA_PRODUCT_LIMIT } from '@/components/storefront/ogabassey/config/products';
import { createOgabasseyHomeProductFeed } from '@/components/storefront/ogabassey/home-product-feed';
import { OgabasseyHomePage } from '@/components/storefront/ogabassey/pages/home';
import type { CategoryNavItem } from '@/lib/cached-categories';
import type {
  getRequestScopedMerchant,
  StorefrontHomeProduct,
} from '@/lib/cached-data';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { asRoute } from '@/lib/routes';
import {
  generateCollectionPageSchema,
  generateLocalBusinessSchema,
  generateMetaDescription,
  generateOrganizationSchema,
  generateWebSiteSchema,
  getProductUrl,
  type LocalBusinessData,
  type OrganizationData,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { OGABASSEY_ENTITY } from '@/lib/storefront/ogabassey-entity';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import { buildStorefrontHomeSemanticGraph } from '@/lib/storefront-home-semantic-graph';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import type { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';

type OgabasseyMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;

export interface OgabasseyHomeProductSectionProps {
  merchant: OgabasseyMerchant;
  pathPrefix: string;
  /**
   * Started (not awaited) by the parent alongside the category/launch legs.
   * Awaiting it here — inside its own Suspense boundary — lets the
   * SEO-critical product grid stream the moment the home-product feed
   * resolves instead of waiting for the slower category/launch legs.
   */
  productsPromise: Promise<StorefrontHomeProduct[]>;
}

/**
 * Below-fold product grid for the OgaBassey homepage. Awaits only the
 * home-product feed: the category navigation and launch-product legs stay in
 * the sibling discovery section, so a slow category query can no longer hold
 * the product links/names/prices out of the streamed HTML.
 *
 * `launchProducts`/`categories` are intentionally not threaded through: with
 * `renderHero={false}` the grid ignores both (launch slides feed only the
 * Hero, which has its own streamed boundary). Re-thread them here if the grid
 * ever consumes either — otherwise this boundary would re-couple to the very
 * legs it exists to stream ahead of.
 */
export async function OgabasseyHomeProductSection({
  merchant,
  pathPrefix,
  productsPromise,
}: OgabasseyHomeProductSectionProps) {
  const products = (await productsPromise) || [];
  const merchantProducts = mapHomeProductsToTemplateProducts(products);
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant);

  return (
    <OgabasseyHomePage
      basePath={pathPrefix}
      products={createOgabasseyHomeProductFeed(
        merchantProducts,
        merchantCurrency
      )}
      renderHero={false}
      storeSlug={merchant.slug}
    />
  );
}

export interface OgabasseyHomeDiscoverySectionProps {
  merchant: OgabasseyMerchant;
  pathPrefix: string;
  productsPromise: Promise<StorefrontHomeProduct[]>;
  /**
   * Fail-open upstream (degrades to an empty nav for the request), so
   * awaiting it here only delays enrichment links and JSON-LD — never the
   * product grid, which streams from its own boundary.
   */
  categoriesPromise: Promise<CategoryNavItem[]>;
  /**
   * Best-effort upstream (never rejects; a feed failure resolves to an empty
   * list), so a launch-feed outage degrades JSON-LD coverage only.
   */
  launchProductsPromise: ReturnType<typeof loadOgabasseyLaunchProducts>;
}

function buildOrganizationGraphSchema(merchant: OgabasseyMerchant) {
  const baseUrl = buildStoreUrl(merchant);
  const trustProfile = buildMerchantTrustProfile(merchant, baseUrl);
  const description =
    merchant.site_description ||
    merchant.site_tagline ||
    `Welcome to ${merchant.business_name}`;

  const businessData: LocalBusinessData = {
    name: merchant.business_name,
    description,
    url: baseUrl,
    logo: merchant.logo_url || undefined,
    telephone: merchant.phone || undefined,
    address: merchant.business_address
      ? {
          street: merchant.business_address,
          country: merchant.country || 'NG',
        }
      : undefined,
    socialMedia:
      Object.keys(trustProfile.socialLinks).length > 0
        ? trustProfile.socialLinks
        : undefined,
  };

  const organizationData: OrganizationData = {
    name: merchant.business_name,
    description,
    url: baseUrl,
    logo: merchant.logo_url || undefined,
    email: trustProfile.supportEmail || merchant.email || undefined,
    telephone: trustProfile.supportPhone || merchant.phone || undefined,
    country: merchant.country || 'NG',
    socialMedia:
      Object.keys(trustProfile.socialLinks).length > 0
        ? trustProfile.socialLinks
        : undefined,
    trustProfile,
  };

  const organizationSchema = generateOrganizationSchema(organizationData);
  const localBusinessSchema = merchant.business_address
    ? generateLocalBusinessSchema(businessData)
    : null;
  const webSiteSchema = generateWebSiteSchema(
    merchant.business_name,
    baseUrl,
    `${baseUrl}/search?q={search_term_string}`
  );

  return {
    '@context': 'https://schema.org',
    '@graph': [organizationSchema, localBusinessSchema, webSiteSchema]
      .filter(Boolean)
      .map((schema) => {
        const { '@context': _, ...rest } = schema as Record<string, unknown>;
        return rest;
      }),
  };
}

/**
 * Crawl-enrichment half of the homepage dynamic content: the semantic-graph
 * JSON-LD and the category/product discovery links. Awaits the category and
 * launch legs (plus the shared product feed for inventory-aware schema
 * prices), so it streams after the product grid — browsers paint products
 * first, while crawlers still receive the fully rendered page.
 */
export async function OgabasseyHomeDiscoverySection({
  merchant,
  pathPrefix,
  productsPromise,
  categoriesPromise,
  launchProductsPromise,
}: OgabasseyHomeDiscoverySectionProps) {
  const [products, categories, launchProducts] = await Promise.all([
    productsPromise,
    categoriesPromise,
    launchProductsPromise,
  ]);
  const merchantProducts = mapHomeProductsToTemplateProducts(products || []);
  // Inventory (manage_stock/stock) lives only on the template rows; the display
  // -shaped launch items drop it. Map slug -> template row so the schema can
  // still derive availability when a launch copy wins the slug dedupe below —
  // otherwise an out-of-stock managed launch item would be emitted as InStock.
  const merchantInventoryBySlug = new Map(
    merchantProducts
      .filter((product) => Boolean(product.slug))
      .map((product) => [product.slug, product] as const)
  );
  // Schema product list: prepend the visible launch items (deduped) so every
  // carousel slide is represented even when it falls outside the top-8 window.
  const schemaProducts = selectLaunchProducts(
    [...launchProducts, ...merchantProducts],
    { limit: OGABASSEY_HOME_SCHEMA_PRODUCT_LIMIT }
  );
  const baseUrl = buildStoreUrl(merchant);
  const merchantCurrency = resolveMerchantCurrencyConfig(merchant);
  const homeDescription = generateMetaDescription(
    merchant.site_description ||
      merchant.site_tagline ||
      `Featured products from ${merchant.business_name}.`
  );
  const homeCollectionSchema =
    merchantProducts.length > 0
      ? generateCollectionPageSchema({
          name: `${merchant.business_name} featured products`,
          description: homeDescription,
          url: baseUrl,
          // The launch items are display-shaped (price as a formatted string);
          // the schema needs a numeric price + string id, so normalize both
          // union members before building the JSON-LD product list. Restore
          // inventory from the template row so availability is correct even when
          // a display-shaped launch copy won the slug dedupe.
          products: schemaProducts.map((product) => {
            const inventory = product.slug
              ? merchantInventoryBySlug.get(product.slug)
              : undefined;
            return {
              ...product,
              id: String(product.id),
              price:
                typeof product.price === 'number'
                  ? product.price
                  : 'rawPrice' in product &&
                      typeof product.rawPrice === 'number'
                    ? product.rawPrice
                    : 0,
              manage_stock: inventory?.manage_stock,
              stock: inventory?.stock,
            };
          }),
          merchantName: merchant.business_name,
          currency: merchantCurrency.code,
        })
      : null;
  const categoryDiscoveryLinks = Array.from(
    new Map(
      (categories || [])
        .map((category) => {
          const canonicalSlug = canonicalizeCategorySlug(category.slug);
          if (!canonicalSlug) return null;
          return [canonicalSlug, { ...category, slug: canonicalSlug }] as const;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    ).values()
  ).slice(0, 20);
  const productDiscoveryLinks = merchantProducts
    .map((product) => {
      const canonicalCategorySlug = product.category_slug
        ? canonicalizeCategorySlug(product.category_slug)
        : undefined;
      const path = getProductUrl({
        id: String(product.id),
        name: product.name,
        slug: product.slug,
        category: product.category,
        categories: product.categories,
        category_slug: canonicalCategorySlug,
      });

      return {
        id: String(product.id),
        name: product.name,
        href: path,
      };
    })
    .slice(0, 24);
  const homeSemanticGraphSchema = buildStorefrontHomeSemanticGraph({
    additionalTopics: ['Consumer electronics retail in Nigeria'],
    baseUrl,
    blogEnabled: Boolean(merchant.feature_settings?.blog_enabled),
    categories: categoryDiscoveryLinks,
    collectionSchema: homeCollectionSchema,
    description: homeDescription,
    identityGraph: buildOrganizationGraphSchema(merchant),
    merchantName: merchant.business_name,
    products: merchantProducts,
    topicalFocus: OGABASSEY_ENTITY.topicalFocus,
  });

  return (
    <>
      <JsonLd data={homeSemanticGraphSchema} />
      <section
        aria-label="Storefront discovery links"
        className="mx-auto mt-8 max-w-[1400px] px-4 md:px-6"
      >
        <div className="rounded-2xl border border-store-background-text/10 bg-store-background p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-store-background-text/70">
            Browse Popular Sections
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              className="rounded-full border border-store-background-text/15 px-3 py-1.5 text-xs font-medium text-store-background-text/80 transition-colors hover:border-store-primary hover:text-store-primary"
              href={asRoute(`${pathPrefix}/products`)}
              prefetch={false}
            >
              All Products
            </Link>
            {merchant.feature_settings?.blog_enabled ? (
              <Link
                className="rounded-full border border-store-background-text/15 px-3 py-1.5 text-xs font-medium text-store-background-text/80 transition-colors hover:border-store-primary hover:text-store-primary"
                href={asRoute(`${pathPrefix}/blog`)}
                prefetch={false}
              >
                Blog
              </Link>
            ) : null}
            {categoryDiscoveryLinks.map((category) => (
              <Link
                key={category.slug}
                className="rounded-full border border-store-background-text/15 px-3 py-1.5 text-xs font-medium text-store-background-text/80 transition-colors hover:border-store-primary hover:text-store-primary"
                href={asRoute(`${pathPrefix}/${category.slug}`)}
                prefetch={false}
              >
                {category.name}
              </Link>
            ))}
          </div>

          {productDiscoveryLinks.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-store-background-text/55">
                Featured Product Links
              </h3>
              <ul className="mt-2 grid gap-1 md:grid-cols-2 lg:grid-cols-3">
                {productDiscoveryLinks.map((link) => (
                  <li key={link.id}>
                    <Link
                      className="text-xs text-store-primary underline-offset-4 hover:underline"
                      href={asRoute(`${pathPrefix}${link.href}`)}
                      prefetch={false}
                    >
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  );
}
