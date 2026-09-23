import {
  buildProductSupportLinks,
  type CommercialSupportLink,
} from '@/lib/storefront-compare/build-commercial-support-links';
import {
  buildCompareDiscoveryLinks,
  PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT,
} from '@/lib/storefront-compare/build-compare-discovery-links';
import { parseCompareSlug } from '@/lib/storefront-compare/compare-slugs';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
} from './product-semantic-types';

export interface ProductSemanticCompareSupport {
  approvedCompareSlugs: ReadonlySet<string>;
  input: BuildProductSemanticModelInput;
  supportLinks: CommercialSupportLink[];
}

export function buildProductHref(
  storeUrl: string,
  product: ProductSemanticCandidate
) {
  return product.category_slug
    ? `${storeUrl}/${product.category_slug}/${product.slug}`
    : `${storeUrl}/products/${product.slug}`;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, '');
}

function buildCategoryHubLink(
  input: BuildProductSemanticModelInput
): CommercialSupportLink {
  return {
    href: `${input.storeUrl}/${input.categorySlug}`,
    label: `Shop more ${input.categoryName}`,
  };
}

function normalizeProductCategorySlug(
  product: ProductSemanticCandidate,
  categorySlug: string
): ProductSemanticCandidate {
  return {
    ...product,
    category_slug: product.category_slug ?? categorySlug,
  };
}

function normalizeSemanticInput(
  input: BuildProductSemanticModelInput
): BuildProductSemanticModelInput {
  return {
    ...input,
    storeUrl: trimTrailingSlash(input.storeUrl),
    currentProduct: normalizeProductCategorySlug(
      input.currentProduct,
      input.categorySlug
    ),
    inventory: input.inventory.map((product) =>
      normalizeProductCategorySlug(product, input.categorySlug)
    ),
  };
}

function getCompareApprovalInventory(input: BuildProductSemanticModelInput) {
  const seenSlugs = new Set<string>();

  return [input.currentProduct, ...input.inventory]
    .filter((product) => product.category_slug === input.categorySlug)
    .filter((product) => {
      if (seenSlugs.has(product.slug)) {
        return false;
      }

      seenSlugs.add(product.slug);
      return true;
    })
    .slice(0, PRODUCT_SCOPED_COMPARE_DISCOVERY_PRODUCT_LIMIT);
}

function extractCategoryCompareSlug(href: string, categorySlug: string) {
  let pathname = '';

  try {
    pathname = new URL(href, 'https://placeholder.local').pathname;
  } catch {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);
  const compareSegmentIndex = segments.findIndex(
    (segment, index) =>
      segment === 'compare' && segments[index - 1] === categorySlug
  );

  return compareSegmentIndex >= 0
    ? segments[compareSegmentIndex + 1] || null
    : null;
}

export function isApprovedSupportLink(input: {
  approvedCompareSlugs: ReadonlySet<string>;
  categorySlug: string;
  href: string;
}) {
  const compareSlug = extractCategoryCompareSlug(
    input.href,
    input.categorySlug
  );

  if (!compareSlug) {
    return true;
  }

  const parsedCompareSlug = parseCompareSlug(compareSlug);

  return parsedCompareSlug
    ? input.approvedCompareSlugs.has(parsedCompareSlug.canonicalSlug)
    : false;
}

function dedupeLinks(links: CommercialSupportLink[]) {
  const seen = new Set<string>();

  return links.filter((link) => {
    if (seen.has(link.href)) {
      return false;
    }

    seen.add(link.href);
    return true;
  });
}

export function buildProductSemanticCompareSupport(
  input: BuildProductSemanticModelInput
): ProductSemanticCompareSupport {
  const normalizedInput = normalizeSemanticInput(input);
  const compareApprovalInventory = getCompareApprovalInventory(normalizedInput);
  const approvedCompareSlugs = new Set(
    buildCompareDiscoveryLinks({
      storeUrl: normalizedInput.storeUrl,
      categorySlug: normalizedInput.categorySlug,
      categoryName: normalizedInput.categoryName,
      includeBrandCompareLinks: false,
      products: compareApprovalInventory,
      requiredProductSlugs: [normalizedInput.currentProduct.slug],
    }).map((link) => link.canonicalSlug)
  );
  const currentProductHref = buildProductHref(
    normalizedInput.storeUrl,
    normalizedInput.currentProduct
  );
  const supportLinkProducts = compareApprovalInventory;
  const supportLinks = dedupeLinks([
    buildCategoryHubLink(normalizedInput),
    ...buildProductSupportLinks({
      approvedCompareSlugs,
      storeUrl: normalizedInput.storeUrl,
      categorySlug: normalizedInput.categorySlug,
      currentProductSlug: normalizedInput.currentProduct.slug,
      currentProductPrice: normalizedInput.currentProduct.price,
      includeBrandCompareLink: false,
      products: supportLinkProducts,
    }),
  ]).filter(
    (link) =>
      link.href !== currentProductHref &&
      isApprovedSupportLink({
        approvedCompareSlugs,
        categorySlug: normalizedInput.categorySlug,
        href: link.href,
      })
  );

  return {
    approvedCompareSlugs,
    input: normalizedInput,
    supportLinks,
  };
}
