import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { isAvailableProduct } from '@/lib/storefront-content/is-available-product';
import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
} from './product-semantic-types';

function normalizeText(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function buildSupplementalSameBrandCandidates(
  input: BuildProductSemanticModelInput,
  normalizedCurrentBrand: string,
  existingSlugs: ReadonlySet<string>
): ProductSemanticCandidate[] {
  const matchedBrandEntry = brandAuthorityTaxonomy
    .getEntries(input.categorySlug)
    .find((entry) =>
      brandAuthorityTaxonomy.matchesBrand(
        entry,
        input.currentProduct.brand ?? null
      )
    );
  const seen = new Set(existingSlugs);
  const candidates: ProductSemanticCandidate[] = [];

  for (const item of input.hubEligibilityInventory ?? []) {
    const slug = item.slug?.trim() ?? '';
    const name = item.name?.trim() ?? '';
    const categorySlug = item.category_slug?.trim() || input.categorySlug;
    const isAvailable =
      item.manage_stock === true
        ? isAvailableProduct(item)
        : item.availability != null
          ? item.availability === 'InStock'
          : isAvailableProduct(item);
    const matchesBrand =
      normalizeText(item.brand) === normalizedCurrentBrand ||
      Boolean(
        matchedBrandEntry &&
          brandAuthorityTaxonomy.matchesBrand(
            matchedBrandEntry,
            item.brand ?? null
          )
      );

    if (
      !slug ||
      !name ||
      slug === input.currentProduct.slug ||
      seen.has(slug) ||
      categorySlug !== input.categorySlug ||
      !matchesBrand ||
      typeof item.price !== 'number' ||
      !Number.isFinite(item.price) ||
      item.price <= 0 ||
      (item.is_parent !== true && item.parent_product_id != null) ||
      !isAvailable
    ) {
      continue;
    }

    seen.add(slug);
    candidates.push({
      slug,
      name,
      price: item.price,
      brand: item.brand ?? input.currentProduct.brand,
      condition: item.condition ?? null,
      stock:
        item.manage_stock !== true && item.stock != null && item.stock <= 0
          ? null
          : (item.stock ?? null),
      stock_quantity: item.stock_quantity ?? null,
      category_slug: categorySlug,
      category_slugs: item.category_slugs ?? null,
      product_key_specs: item.product_key_specs ?? null,
      is_parent: item.is_parent ?? null,
      parent_product_id: item.parent_product_id ?? null,
      manage_stock:
        item.manage_stock ??
        (item.manage_stock !== true && item.stock != null && item.stock <= 0
          ? false
          : null),
    });
  }

  return candidates;
}
