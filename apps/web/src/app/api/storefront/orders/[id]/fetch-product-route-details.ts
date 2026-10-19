import type { OrderItem } from './order-item-types';

type ProductRouteDetails = {
  product_slug?: string | null;
  gtin?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?: { name?: string; slug?: string } | null;
};

export async function fetchProductRouteDetails(
  items: OrderItem[],
  loadProducts: (productIds: string[]) => Promise<{
    data: Array<{
      id: string;
      slug: string | null;
      gtin: string | null;
      category: string | null;
      categories?:
        | { name?: string; slug?: string }[]
        | { name?: string; slug?: string }
        | null;
    }> | null;
    error: { message?: string } | null;
  }>
) {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.product_id)
        .filter((value): value is string => Boolean(value))
    )
  );

  if (productIds.length === 0) {
    return new Map<string, ProductRouteDetails>();
  }

  const { data, error } = await loadProducts(productIds);

  if (error || !data) {
    console.warn(
      'Failed to fetch product route details for order items',
      error
    );
    return new Map<string, ProductRouteDetails>();
  }

  return new Map(
    data.map((product) => [
      product.id,
      {
        product_slug: product.slug,
        gtin: product.gtin,
        category: product.category,
        category_slug: Array.isArray(product.categories)
          ? product.categories[0]?.slug || null
          : product.categories?.slug || null,
        categories: Array.isArray(product.categories)
          ? product.categories[0] || null
          : product.categories || null,
      },
    ])
  );
}
