import { normalizeVariantAttributes } from '@/lib/product-picker-variant-rows';
import { getJoinedRecord } from '@/lib/supabase-utils';

interface OrderItemRow {
  condition: string | null;
  has_assurance: boolean | null;
  id: string;
  image_url: string | null;
  item_description: string | null;
  name: string | null;
  price: number;
  product_match_status: 'custom' | 'linked' | 'unreviewed' | null;
  product_id: string | null;
  products:
    | {
        categories:
          | {
              name: string | null;
              slug: string | null;
            }
          | Array<{
              name: string | null;
              slug: string | null;
            }>
          | null;
        category: string | null;
        condition: string | null;
        images: string[] | null;
        name: string;
      }
    | Array<{
        categories:
          | {
              name: string | null;
              slug: string | null;
            }
          | Array<{
              name: string | null;
              slug: string | null;
            }>
          | null;
        category: string | null;
        condition: string | null;
        images: string[] | null;
        name: string;
      }>
    | null;
  quantity: number;
  variant_attributes: unknown;
  variant_id: string | null;
  variant_name: string | null;
}

export function mapOrderItems(items: OrderItemRow[] | null | undefined) {
  return (items ?? []).map((item) => {
    const product = getJoinedRecord(item.products);
    const productCategory = getJoinedRecord(product?.categories);
    const itemName = item.name ?? product?.name ?? 'Unnamed item';
    const categoryName =
      productCategory?.name ?? product?.category ?? undefined;

    return {
      category: categoryName,
      category_slug: productCategory?.slug ?? undefined,
      condition: item.condition ?? undefined,
      details: item.item_description ?? undefined,
      display_condition: item.condition ?? product?.condition ?? undefined,
      display_image_url: item.image_url ?? product?.images?.[0],
      has_assurance: item.has_assurance ?? undefined,
      id: item.id,
      image_url: item.image_url ?? undefined,
      name: itemName,
      price: item.price,
      product_id: item.product_id ?? null,
      product_match_status: item.product_match_status ?? undefined,
      product_name: itemName,
      quantity: item.quantity,
      variant_attributes:
        normalizeVariantAttributes(item.variant_attributes) ?? undefined,
      variant_id: item.variant_id ?? null,
      variant_name: item.variant_name ?? undefined,
    };
  });
}
