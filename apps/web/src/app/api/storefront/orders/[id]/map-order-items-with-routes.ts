import { formatCanonicalProductConditionLabel } from '@baci/shared/lib';
import type { OrderItem } from './order-item-types';

type ProductRouteDetails = {
  product_slug?: string | null;
  gtin?: string | null;
  category?: string | null;
  category_slug?: string | null;
  categories?: { name?: string; slug?: string } | null;
};

function extractJoinedProduct(products: OrderItem['products']) {
  return Array.isArray(products) ? products[0] || null : products || null;
}

function flattenOrderItemProductData(item: OrderItem) {
  const product = extractJoinedProduct(item.products);
  const categories = Array.isArray(product?.categories)
    ? product?.categories[0] || null
    : product?.categories || item.categories || null;

  return {
    product_slug: product?.slug || item.product_slug,
    gtin: product?.gtin || item.gtin || null,
    category: product?.category || item.category,
    category_slug: categories?.slug || item.category_slug,
    categories,
  };
}

function getOrderItemVariantName(item: OrderItem) {
  return (
    item.variant_name ||
    formatCanonicalProductConditionLabel(item.condition) ||
    undefined
  );
}

export function mapOrderItemsWithRoutes(
  items: OrderItem[],
  productRouteDetails?: Map<string, ProductRouteDetails>
) {
  return items.map((item: OrderItem) => {
    const displayName = item.product_name || item.name || '';
    return {
      id: item.id,
      product_id: item.product_id,
      product_name: displayName,
      name: displayName,
      quantity: item.quantity,
      price: item.price,
      condition: item.condition || null,
      image_url: item.image_url,
      variant_name: getOrderItemVariantName(item) || null,
      product_images: item.product_images,
      ...flattenOrderItemProductData(item),
      ...(productRouteDetails?.get(item.product_id) || {}),
    };
  });
}
