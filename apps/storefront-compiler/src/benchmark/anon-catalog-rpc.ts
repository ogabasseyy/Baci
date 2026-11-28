import type {
  BackingCatalogProduct,
  PublicProjectedProduct,
} from './ogabassey-catalog-fixture';

export interface CatalogSearchResponse {
  merchantId: string;
  generation: number;
  availabilityGeneration: number;
  title: string;
  categoryExists: boolean;
  products: PublicProjectedProduct[];
  facets: {
    brands: Array<{ value: string; count: number }>;
    conditions: Array<{ value: string; count: number }>;
    totalMatches: number;
  };
}

export function projectSafeProduct(
  row: BackingCatalogProduct,
  stockOverride?: ReadonlyMap<string, number>
): PublicProjectedProduct {
  const projectedVariants = row.variants.map((variant) => {
    const qty = stockOverride?.get(variant.id) ?? variant.stockQty;
    return {
      id: variant.id,
      label: variant.label,
      storage: variant.storage,
      color: variant.color,
      priceNgn: variant.priceNgn,
      inStock: qty > 0,
    };
  });
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    categorySlug: row.categorySlug,
    categoryName: row.categoryName,
    brand: row.brand,
    condition: row.condition,
    priceNgn: row.priceNgn,
    inStock: projectedVariants.some((variant) => variant.inStock),
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    shortSpecs: row.shortSpecs,
    variants: projectedVariants,
  };
}

export function executeSimulatedAnonCatalogRpc(
  url: URL,
  merchantId: string,
  rows: readonly BackingCatalogProduct[],
  generations: { coupled: number; availability: number }
): string {
  const publishedRows = rows.filter((row) => row.isPublished);

  if (url.pathname === '/v1/product') {
    const slug = url.searchParams.get('productSlug') ?? '';
    const productId = url.searchParams.get('productId') ?? '';
    const sku = url.searchParams.get('sku') ?? '';
    const category = url.searchParams.get('category');
    const categoryId = url.searchParams.get('categoryId');
    const hasProdFilter = sku !== '' || slug !== '' || productId !== '';
    const found = publishedRows.find(
      (row) =>
        hasProdFilter &&
        (sku === '' ||
          row.slug === sku ||
          row.variants.some((v) => v.sku === sku)) &&
        (slug === '' || row.slug === slug) &&
        (productId === '' || row.id === productId) &&
        (!category || row.categorySlug === category) &&
        (!categoryId || row.categoryId === categoryId)
    );
    return JSON.stringify({
      merchantId,
      generation: generations.coupled,
      availabilityGeneration: generations.availability,
      product: found ? projectSafeProduct(found) : null,
    });
  }

  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const category = (url.searchParams.get('category') ?? '')
    .trim()
    .toLowerCase();
  const categoryId = (url.searchParams.get('categoryId') ?? '').trim();
  const brand = (url.searchParams.get('brand') ?? '').trim().toLowerCase();
  const condition = (url.searchParams.get('condition') ?? '')
    .trim()
    .toLowerCase();
  const limitParam = url.searchParams.get('limit')?.trim();
  const rawLimit = limitParam ? Number(limitParam) : 24;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 48)
    : 24;
  const pageParam = url.searchParams.get('page')?.trim();
  const rawPage = pageParam ? Number(pageParam) : 1;
  const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1;

  const categoryExists =
    (!category && !categoryId) ||
    publishedRows.some(
      (row) =>
        (!category || row.categorySlug === category) &&
        (!categoryId || row.categoryId === categoryId)
    );

  const matched = publishedRows.filter((row) => {
    if (category && row.categorySlug !== category) return false;
    if (categoryId && row.categoryId !== categoryId) return false;
    if (brand && row.brand.toLowerCase() !== brand) return false;
    if (condition && row.condition.toLowerCase() !== condition) return false;
    if (
      q &&
      !row.name.toLowerCase().includes(q) &&
      !row.brand.toLowerCase().includes(q) &&
      !row.shortSpecs.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });

  const brandCounts = new Map<string, number>();
  const conditionCounts = new Map<string, number>();
  for (const row of matched) {
    brandCounts.set(row.brand, (brandCounts.get(row.brand) ?? 0) + 1);
    conditionCounts.set(
      row.condition,
      (conditionCounts.get(row.condition) ?? 0) + 1
    );
  }

  const offset = (page - 1) * limit;
  const slice = matched
    .slice(offset, offset + limit)
    .map((row) => projectSafeProduct(row));

  const payload: CatalogSearchResponse = {
    merchantId,
    generation: generations.coupled,
    availabilityGeneration: generations.availability,
    title: category
      ? `${category.charAt(0).toUpperCase()}${category.slice(1)}`
      : q
        ? `Search: "${q}"`
        : 'Featured Flagship Devices',
    categoryExists,
    products: slice,
    facets: {
      brands: Array.from(brandCounts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
      conditions: Array.from(conditionCounts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
      totalMatches: matched.length,
    },
  };
  return JSON.stringify(payload);
}
