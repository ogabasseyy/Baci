import { getEffectiveProductStock } from '@baci/shared';
import { getPrimaryProductImage } from '@/lib/product-image';
import type { MerchantQuizGenerationInput } from '@/schemas/quiz';
import type { QuizSupabaseClient } from './quiz-generate-helpers';

const PRODUCT_COLUMNS =
  'id, merchant_id, name, images, condition, default_variant_id, has_variants, manage_stock, stock, stock_quantity';
const VARIANT_COLUMNS =
  'id, merchant_id, product_id, condition, stock_quantity, primary_image, images, is_inventory_anchor';

type ProductRow = {
  condition: string | null;
  default_variant_id: string | null;
  has_variants: boolean | null;
  id: string;
  images: Array<string | { url?: string | null }> | null;
  manage_stock: boolean | null;
  merchant_id: string;
  name: string;
  stock: number | string | null;
  stock_quantity: number | string | null;
};

type VariantRow = {
  condition: string | null;
  id: string;
  images: Array<string | { url?: string | null }> | null;
  is_inventory_anchor: boolean | null;
  merchant_id: string;
  primary_image: string | null;
  product_id: string;
  stock_quantity: number | string | null;
};

export type ResolvedQuizPrize = {
  condition: string;
  imageUrl: string | null;
  name: string;
  productId: string;
  variantId: string | null;
};

export async function resolveQuizPrizeSelection(
  supabase: QuizSupabaseClient,
  merchantId: string,
  input: MerchantQuizGenerationInput
): Promise<ResolvedQuizPrize | null> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('id', input.prizeProductId)
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) return null;
  const product = data as ProductRow;
  if (product.merchant_id !== merchantId || !product.name?.trim()) return null;

  let condition = product.condition?.trim() || 'unspecified';
  let imageUrl = getPrimaryProductImage(product.images);
  let effectiveStock =
    product.manage_stock === true ? getEffectiveProductStock(product) : null;
  let variantId: string | null = null;

  if (product.has_variants === true) {
    if (!input.prizeVariantId) return null;
    const { data: variantData, error: variantError } = await supabase
      .from('product_variants')
      .select(VARIANT_COLUMNS)
      .eq('id', input.prizeVariantId)
      .eq('product_id', product.id)
      .eq('merchant_id', merchantId)
      .maybeSingle();
    if (variantError || !variantData) return null;
    const variant = variantData as VariantRow;
    if (
      variant.merchant_id !== merchantId ||
      variant.product_id !== product.id ||
      // Stale clients can still submit an anchor id; the prize reserve
      // RPC rejects anchors, so refuse them at selection time too.
      variant.is_inventory_anchor === true
    )
      return null;
    variantId = variant.id;
    condition = variant.condition?.trim() || condition;
    imageUrl =
      getPrimaryProductImage([
        variant.primary_image ?? '',
        ...(variant.images ?? []),
      ]) ?? imageUrl;
    effectiveStock =
      product.manage_stock === true
        ? Math.max(0, Math.trunc(Number(variant.stock_quantity ?? 0)))
        : null;
  } else if (input.prizeVariantId) {
    return null;
  }

  if (product.manage_stock === true && (effectiveStock ?? 0) < 1) return null;
  if (
    input.prizeCondition !== condition ||
    input.prizeEffectiveStock !== effectiveStock ||
    input.prizeImageUrl !== imageUrl
  ) {
    return null;
  }

  return {
    condition,
    imageUrl,
    name: product.name.trim(),
    productId: product.id,
    variantId,
  };
}
