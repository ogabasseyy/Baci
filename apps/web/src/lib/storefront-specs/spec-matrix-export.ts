import type { ProductSpecSection } from './spec-data';
import { buildProductSpecData } from './spec-data';
import type { ComparableProductKeySpecs } from './spec-taxonomy';
import type { VariantAttributeSource } from './variant-attributes';

const COMPARISON_MATRIX_EXPORT_SCHEMA_VERSION = 'comparison-matrix-v1';

type ExportAvailability = 'InStock' | 'OutOfStock';
type ExportInventoryPolicy = 'managed' | 'unmanaged';

interface ComparisonMatrixExportProductInput {
  id: string | number;
  slug: string;
  name: string;
  category_slug: string;
  brand?: string | null;
  price: number;
  condition?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  description?: string | null;
  detailedSpecs?: ProductSpecSection[] | null;
  manage_stock?: boolean | null;
  product_key_specs?: ComparableProductKeySpecs | null;
  specifications?: ProductSpecSection[] | null;
  specs?: { label: string; value: string }[] | string | null;
  stock_quantity?: number | null;
  variant_attributes?: VariantAttributeSource;
}

interface ComparisonMatrixExportInput {
  merchantId: string;
  storeUrl: string;
  generatedAt: string;
  approvedCompareSlugs: string[];
  products: ComparisonMatrixExportProductInput[];
}

function normalizeStoreUrl(storeUrl: string) {
  return storeUrl.replace(/\/+$/, '');
}

function getAvailability(product: ComparisonMatrixExportProductInput) {
  if (product.manage_stock !== true) {
    return {
      availability: 'InStock' as ExportAvailability,
      inventory_policy: 'unmanaged' as ExportInventoryPolicy,
    };
  }

  return {
    availability:
      typeof product.stock_quantity === 'number' && product.stock_quantity <= 0
        ? ('OutOfStock' as ExportAvailability)
        : ('InStock' as ExportAvailability),
    inventory_policy: 'managed' as ExportInventoryPolicy,
  };
}

function getSourceUpdatedAt(
  product: ComparisonMatrixExportProductInput,
  generatedAt: string
) {
  const keySpecsCreatedAt = product.product_key_specs?.created_at;

  return typeof keySpecsCreatedAt === 'string' && keySpecsCreatedAt
    ? keySpecsCreatedAt
    : product.updated_at || product.created_at || generatedAt;
}

export function buildComparisonMatrixExport(
  input: ComparisonMatrixExportInput
) {
  const storeUrl = normalizeStoreUrl(input.storeUrl);
  const approvedCompareSlugs = Array.from(
    new Set(input.approvedCompareSlugs)
  ).sort();
  const products = input.products
    .slice()
    .sort(
      (left, right) =>
        left.category_slug.localeCompare(right.category_slug) ||
        left.slug.localeCompare(right.slug)
    )
    .map((product) => {
      // The export input carries the canonical category as a slug rather than
      // the storefront comparison input's `category` field. Pass it through
      // so category-aware spec families keep producing the correct taxonomy.
      const specData = buildProductSpecData({
        ...product,
        category: product.category_slug,
      });

      return {
        id: String(product.id),
        slug: product.slug,
        name: product.name,
        category_slug: product.category_slug,
        brand: product.brand || null,
        price: product.price,
        canonical_url: `${storeUrl}/${product.category_slug}/${product.slug}`,
        ...getAvailability(product),
        matrix_source: {
          source: 'catalog',
          source_updated_at: getSourceUpdatedAt(product, input.generatedAt),
          confidence: 'catalog_verified',
        },
        product_key_specs: product.product_key_specs ?? {},
        comparison_summary_rows: specData.specs,
        comparison_detail_groups: specData.detailedSpecs,
      };
    });

  return {
    schema_version: COMPARISON_MATRIX_EXPORT_SCHEMA_VERSION,
    merchant_id: input.merchantId,
    generated_at: input.generatedAt,
    approved_compare_slugs: approvedCompareSlugs,
    products,
  };
}
