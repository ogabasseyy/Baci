import {
  MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY,
  normalizeProductVariantModel,
} from '@baci/shared';
import { normalizeProductInventory } from '@/lib/product-inventory';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';
import { supabase } from '@/lib/supabase';
import { getJoinedRecord } from '@/lib/supabase-utils';
import type { Product, ProductWithVariants } from './products.types';
import { fetchAdminProductVariants } from './useProductPickerVariants';

export async function fetchProductDetail(args: {
  merchantId: string;
  productId: string;
}): Promise<ProductWithVariants | null> {
  if (!args.productId || args.productId === 'new') return null;

  const { data: productData, error: productError } = await supabase
    .from('merchant_products')
    .select(MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY)
    .eq('id', args.productId)
    .eq('merchant_id', args.merchantId)
    .single();

  if (productError) throw productError;

  const withRelations = productData as Product & {
    categories?: { name: string } | Array<{ name: string }> | null;
    brands?: { name: string } | Array<{ name: string }> | null;
  };
  const category = getJoinedRecord(withRelations.categories);
  const brand = getJoinedRecord(withRelations.brands);
  const variants: AdminProductVariant[] = withRelations.has_variants
    ? await fetchAdminProductVariants({
        merchantId: args.merchantId,
        parentProduct: {
          condition: withRelations.condition,
          id: withRelations.id,
          images: withRelations.images,
          name: withRelations.name,
          price: withRelations.price,
        },
      })
    : [];

  return {
    ...normalizeProductInventory(withRelations),
    brands: brand ? { name: brand.name } : undefined,
    categories: category ? { name: category.name } : undefined,
    variant_model: normalizeProductVariantModel(withRelations.variant_model),
    variants,
  };
}
