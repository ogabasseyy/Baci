import {
  getEffectiveProductStock,
  getImagePayloadUrl,
  type ProductSelectionRequiredInput,
} from '@baci/shared/lib';

interface ChatProductRow extends ProductSelectionRequiredInput {
  condition?: string | null;
  minimum_order_quantity?: number | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  has_variants?: boolean | null;
  id: string;
  images: unknown;
  manage_stock?: boolean | null;
  name: string;
  price: number;
  slug?: string | null;
  status: string | null;
  stock: number | null;
  stock_quantity?: number | null;
}

export interface ChatProductResult extends ProductSelectionRequiredInput {
  condition?: string | null;
  minimum_order_quantity?: number | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  has_variants?: boolean;
  id: string;
  image_url: string | null;
  manage_stock?: boolean;
  name: string;
  price: number;
  slug?: string | null;
  status: string | null;
  stock: number | null;
}

function getFirstImageUrl(images: unknown): string | null {
  if (!Array.isArray(images)) return null;

  for (const image of images) {
    const url = getImagePayloadUrl(image);
    if (url) return url;
  }
  return null;
}

/** Maps the exact public fields a chat card may receive from catalog tools. */
export function createChatProductResult(
  product: ChatProductRow
): ChatProductResult {
  return {
    ...(product.condition !== undefined
      ? { condition: product.condition }
      : {}),
    ...(product.minimum_order_quantity !== undefined
      ? { minimum_order_quantity: product.minimum_order_quantity }
      : {}),
    brand: product.brand,
    category: product.category,
    description: product.description,
    ...(product.available_conditions !== undefined
      ? { available_conditions: product.available_conditions }
      : {}),
    ...(product.has_condition_offers !== undefined
      ? { has_condition_offers: product.has_condition_offers }
      : {}),
    ...(product.variant_model !== undefined
      ? { variant_model: product.variant_model }
      : {}),
    ...(product.has_variants !== undefined
      ? { has_variants: product.has_variants === true }
      : {}),
    id: product.id,
    image_url: getFirstImageUrl(product.images),
    ...(product.manage_stock !== undefined
      ? { manage_stock: product.manage_stock === true }
      : {}),
    name: product.name,
    price: product.price,
    ...(product.slug !== undefined ? { slug: product.slug } : {}),
    status: product.status,
    stock: getEffectiveProductStock(product),
  };
}
