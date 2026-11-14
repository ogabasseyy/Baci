import { isDeepStrictEqual } from 'node:util';
import type { PublicCatalog } from '@baci/shared/experience';
import { productionOrigin } from '@/lib/experience/production-origins';
import type { PublishedManifest } from '@/lib/experience/published-manifest';
import { normalizeExperiencePath } from '@/lib/experience/route-ownership';
import type { ExperienceBoundaryData } from '@/lib/experience/storefront-runtime';

type Merchant = { id: string; slug: string };
type Binding = {
  merchantId: string;
  slug: string;
  buildDigest: string;
  publicationRevision: number;
  canonicalBase: string;
  scriptDigest: string;
  styleDigest: string;
  assets: Record<string, string>;
  head: PublishedManifest;
};

/** Resolve expected coverage from a bound head and public RLS-backed runtime. */
export async function derivePublicVerificationPlan(
  binding: Binding,
  runtime: {
    catalog(
      merchant: Merchant,
      selection: Record<string, never>
    ): Promise<PublicCatalog | null>;
    resolveBoundary(
      merchant: Merchant,
      path: string
    ): Promise<
      | (Pick<ExperienceBoundaryData, 'manifest' | 'title' | 'canonicalUrl'> & {
          bootstrap: { route: { routeId: string } };
        })
      | null
    >;
  }
) {
  const base = productionOrigin(binding.canonicalBase);
  if (
    binding.head.merchantId !== binding.merchantId ||
    binding.head.buildDigest !== binding.buildDigest ||
    binding.head.version !== binding.publicationRevision ||
    !binding.head.routes.some((route) => route.view === 'home') ||
    !binding.head.routes.some((route) => route.view === 'product')
  )
    throw Error('PUBLIC_BINDING_MISMATCH');
  const merchant = { id: binding.merchantId, slug: binding.slug };
  const catalog = await runtime.catalog(merchant, {});
  const product = [...(catalog?.products ?? [])]
    .sort((a, b) => a.id.localeCompare(b.id))
    .find(
      (item) =>
        item.available &&
        (!item.requiresVariant ||
          item.variants.some((variant) => variant.available))
    );
  if (!product) throw Error('PUBLIC_JOURNEY_NOT_READY');
  const variant = product.requiresVariant
    ? product.variants
        .filter((item) => item.available)
        .sort((a, b) => a.id.localeCompare(b.id))[0]
    : undefined;
  const productPath = normalizeExperiencePath(
    product.canonicalPath ?? `/products/${product.slug}`
  );
  const routes = [];
  for (const route of binding.head.routes) {
    const path =
      route.view === 'product'
        ? productPath
        : route.view === 'collection'
          ? '/collections/all'
          : normalizeExperiencePath(route.path);
    const boundary = await runtime.resolveBoundary(merchant, path);
    if (
      !boundary ||
      !isDeepStrictEqual(boundary.manifest, binding.head) ||
      boundary.bootstrap.route.routeId !== route.view ||
      boundary.canonicalUrl !== `${base}${path}` ||
      !boundary.title ||
      boundary.title.length > 500
    )
      throw Error('PUBLIC_BINDING_MISMATCH');
    routes.push({
      path,
      canonical: boundary.canonicalUrl,
      title: boundary.title,
    });
  }
  return {
    buildDigest: binding.buildDigest,
    publicationRevision: binding.publicationRevision,
    scriptDigest: binding.scriptDigest,
    styleDigest: binding.styleDigest,
    assets: binding.assets,
    routes,
    product: {
      id: product.id,
      slug: product.slug,
      ...(variant ? { variantId: variant.id } : {}),
      path: productPath,
    },
    journeySteps: [
      { action: 'navigate' as const, path: '/' },
      { action: 'product' as const, path: productPath },
      { action: 'cart-add' as const, path: productPath },
      { action: 'cart-read' as const, path: '/cart' },
      { action: 'checkout-review' as const, path: '/checkout' },
    ],
  };
}
